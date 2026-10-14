const crypto = require("crypto");
const { createTencentClient } = require("../../modules/meetings/tencent");
const { createMeetingConfig } = require("../../modules/meetings/config");
const { clipContent } = require("../../modules/meetings/importer");

describe("Tencent Meeting connector", () => {
  test("signs the complete canonical URI using Tencent's documented TC3 header order", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: new URL(url), options });
      return { ok: true, status: 200, json: async () => ({ meeting_info_list: [], remaining: 0 }) };
    };
    const client = createTencentClient({
      config: { secretId: "AKIDfixture", secretKey: "fixture-secret", appId: "123", userId: "operator", operatorId: "operator", operatorIdType: 1 },
      fetchImpl,
      now: () => 1_700_000_000_000,
      nonce: () => 12345,
    });

    await client.listMeetings({ from: 1_700_000_000, to: 1_700_086_400, cursor: "2" });

    const { url, options } = calls[0];
    const uri = `${url.pathname}${url.search}`;
    const canonical = `GET\nX-TC-Key=AKIDfixture&X-TC-Nonce=12345&X-TC-Timestamp=1700000000\n${uri}\n`;
    const hex = crypto.createHmac("sha256", "fixture-secret").update(canonical).digest("hex");
    expect(url.origin).toBe("https://api.meeting.qq.com");
    expect(options.headers["X-TC-Signature"]).toBe(Buffer.from(hex, "utf8").toString("base64"));
    expect(options.headers.AppId).toBe("123");
    expect(options.headers["X-TC-Nonce"]).toBe("12345");
  });

  test("maps official history pages and returns the next page cursor", async () => {
    const urls = [];
    const client = createTencentClient({
      config: { secretId: "id", secretKey: "key", appId: "app", userId: "u" },
      fetchImpl: async (url) => {
        urls.push(new URL(url));
        return { ok: true, status: 200, json: async () => ({
          total_page: 2,
          current_page: 1,
          meeting_info_list: [{ meeting_id: "m1", subject: "Review", start_time: "1700000000", end_time: "1700003600" }],
        }) };
      },
      now: () => 1_700_100_000_000,
      nonce: () => 11,
    });
    const result = await client.listMeetings({ from: 1_700_000_000, to: 1_700_086_400 });
    expect(urls[0].pathname).toBe("/v1/history/meetings/u");
    expect(urls[0].searchParams.get("page")).toBe("1");
    expect(result.items).toEqual([{ externalId: "m1", title: "Review", startTime: "2023-11-14T22:13:20.000Z", endTime: "2023-11-14T23:13:20.000Z" }]);
    expect(result.nextCursor).toBe("2");
  });

  test("times out and does not expose credentials in errors", async () => {
    const client = createTencentClient({
      config: { secretId: "secret-id-value", secretKey: "secret-key-value", appId: "app", userId: "u" },
      fetchImpl: async () => { throw new Error("request failed"); },
      timeoutMs: 100,
    });
    await expect(client.listMeetings({ from: 100, to: 200 })).rejects.toThrow("Tencent Meeting request failed");
    await expect(client.listMeetings({ from: 100, to: 200 })).rejects.not.toThrow("secret-key-value");
  });

  test("downloads only returned HTTPS Tencent artifact URLs without sending AK/SK headers", async () => {
    let request;
    const client = createTencentClient({
      config: { secretId: "private-id", secretKey: "private-key", appId: "private-app", userId: "u" },
      fetchImpl: async (url, options) => {
        request = { url, options };
        return { ok: true, headers: { get: () => "3" }, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
      },
    });
    expect(await client.downloadAttachment("https://download.tencent.com/files/file.txt")).toEqual(Buffer.from([1, 2, 3]));
    expect(request.options.headers).toEqual({});
    expect(request.url).toBe("https://download.tencent.com/files/file.txt");
    await expect(client.downloadAttachment("https://example.com/file.txt")).rejects.toMatchObject({ code: "INVALID_TENCENT_DOWNLOAD_URL" });
  });

  test("normalizes multiple recording timestamps onto one timeline and exposes only a URL-free manifest", async () => {
    const firstStart = 1_700_000_000_000;
    const calls = [];
    const fetchImpl = async (url) => {
      const parsed = new URL(url);
      calls.push(parsed);
      if (parsed.pathname === "/v1/records") return { ok: true, status: 200, json: async () => ({ total_page: 1, record_meetings: [{
        meeting_id: "m-1", record_files: [
          { record_file_id: "rf-1", record_start_time: firstStart, record_end_time: firstStart + 1_000 },
          { record_file_id: "rf-2", record_start_time: firstStart + 4 * 60 * 60 * 1_000, record_end_time: firstStart + 4 * 60 * 60 * 1_000 + 1_000 },
        ],
      }] }) };
      if (parsed.pathname === "/v1/records/transcripts/details") return { ok: true, status: 200, json: async () => ({ minutes: { paragraphs: [{
        pid: "0", start_time: 0, end_time: 1000, sentences: [{ words: [{ text: parsed.searchParams.get("record_file_id") }] }],
      }] } }) };
      if (parsed.pathname.startsWith("/v1/addresses/")) return { ok: true, status: 200, json: async () => ({ ai_minutes: [{ file_type: "txt", download_address: "https://download.tencent.com/secret-url" }] }) };
      throw new Error("unexpected endpoint");
    };
    const client = createTencentClient({
      config: { secretId: "id", secretKey: "key", appId: "app", userId: "u", operatorId: "u", capabilities: { transcript: "supported", attachments: "supported" } },
      fetchImpl, now: () => firstStart, nonce: () => 11,
    });
    const content = await client.getContent("m-1", { meetingStartTime: firstStart, meetingEndTime: firstStart + 86_400_000 });
    expect(content.segments.map((segment) => [segment.text, segment.location.startMs, segment.location.recordFileId])).toEqual([
      ["rf-1", 0, "rf-1"], ["rf-2", 4 * 60 * 60 * 1_000, "rf-2"],
    ]);
    expect(clipContent(content, { from: 0, to: 3 * 60 * 60 * 1_000 }).segments).toHaveLength(1);
    const manifest = await client.describeMeeting("m-1", { startTime: firstStart, endTime: firstStart + 86_400_000 });
    expect(manifest.attachments).toEqual([{
      externalFileId: "rf-1:ai_minutes:txt", name: "rf-1.txt", sourceType: "TENCENT_ORIGINAL", artifactType: "ai_minutes", bytes: null, maxBytes: 100_000_000,
    }, {
      externalFileId: "rf-2:ai_minutes:txt", name: "rf-2.txt", sourceType: "TENCENT_ORIGINAL", artifactType: "ai_minutes", bytes: null, maxBytes: 100_000_000,
    }]);
    expect(JSON.stringify(manifest)).not.toContain("secret-url");
    expect(manifest.transcriptDurationMs).toBe(4 * 60 * 60 * 1_000 + 1_000);
  });

  test("redacts credentials from public configuration and keeps audit records secret-free", async () => {
    const rows = [];
    const prisma = {
      meeting_connections: {
        findFirst: async () => rows[0] || null,
        upsert: async ({ create, update }) => {
          rows[0] = { id: 1, ...create, ...(rows[0] ? update : {}) };
          return rows[0];
        },
      },
    };
    const auditEntries = [];
    const encryption = {
      encrypt: (value) => `enc:${value}`,
      decrypt: (value) => value.slice(4),
    };
    const service = createMeetingConfig({ prisma, encryption, audit: async (entry) => auditEntries.push(entry) });
    await service.save({ id: 1, name: "Ops", secretId: "secret-id", secretKey: "secret-key", appId: "tenant", userId: "user" }, 9);
    const publicConfig = await service.getPublic();
    expect(publicConfig).toMatchObject({ name: "Ops", configured: true });
    expect(publicConfig).not.toMatchObject({ secretId: "secret-id", secretKey: "secret-key" });
    expect(await service.getPrivate()).toMatchObject({ secretId: "secret-id", secretKey: "secret-key" });
    expect(JSON.stringify(auditEntries)).not.toContain("secret-key");
  });
});
