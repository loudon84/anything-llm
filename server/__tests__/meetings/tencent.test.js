const crypto = require("crypto");
const { createTencentClient } = require("../../modules/meetings/tencent");
const { createMeetingConfig } = require("../../modules/meetings/config");
const { clipContent } = require("../../modules/meetings/importer");

describe("Tencent Meeting connector", () => {
  test("signs the complete canonical URI using Tencent's documented TC3 header order", async () => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url: new URL(url), options });
      return { ok: true, status: 200, json: async () => ({ total_page: 1, current_page: 1, meeting_info_list: [], remaining: 0 }) };
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
      if (parsed.pathname === "/v1/records/transcripts/details") return { ok: true, status: 200, json: async () => ({ more: false, minutes: { paragraphs: [{
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

  test("encrypts OCR tokens, preserves blank updates, exposes current parser settings, and rolls back on audit failure", async () => {
    const rows = [];
    const prisma = {
      meeting_connections: { findFirst: async () => rows[0] || null },
    };
    prisma.$transaction = async (callback) => {
      const pending = [...rows];
      const tx = {
        meeting_connections: {
          upsert: async ({ create, update }) => {
            pending[0] = { id: 1, ...create, ...(pending[0] ? update : {}) };
            return pending[0];
          },
        },
      };
      const result = await callback(tx);
      rows.splice(0, rows.length, ...pending);
      return result;
    };
    const encryption = {
      encrypt: (value) => Buffer.from(value).toString("base64"),
      decrypt: (value) => Buffer.from(value, "base64").toString(),
    };
    const service = createMeetingConfig({ prisma, encryption });
    await service.save(
      {
        id: 1,
        appId: "app",
        secretId: "id",
        secretKey: "key",
        services: {
          ocr: {
            url: "https://ocr.example/parse",
            token: "synthetic-ocr-secret",
          },
        },
      },
      7
    );
    expect(await service.getPublic()).toMatchObject({
      services: { ocr: { url: "https://ocr.example/parse", configured: true } },
    });
    expect(JSON.stringify(await service.getPublic())).not.toContain(
      "synthetic-ocr-secret"
    );
    await service.save(
      {
        id: 1,
        services: { ocr: { url: "https://ocr.example/parse", token: "" } },
      },
      7
    );
    expect(await service.getPrivate()).toMatchObject({
      services: {
        ocr: {
          url: "https://ocr.example/parse",
          token: "synthetic-ocr-secret",
        },
      },
    });
    expect(JSON.stringify(rows[0].config)).not.toContain(
      "synthetic-ocr-secret"
    );
    const failing = createMeetingConfig({
      prisma,
      encryption,
      audit: async () => {
        throw new Error("audit unavailable");
      },
    });
    await expect(
      failing.save({ id: 1, name: "must rollback" }, 7)
    ).rejects.toThrow("audit unavailable");
    expect(rows[0].name).toBe("Tencent Meeting");
  });

  const connectorConfig = (capabilities = {}) => ({
    secretId: "id", secretKey: "key", appId: "app", userId: "u", operatorId: "u", capabilities,
  });
  const recordsResponse = (files = [{ record_file_id: "rf-1", record_start_time: 1_700_000_000_000, record_end_time: 1_700_000_010_000 }]) => ({
    ok: true, status: 200,
    json: async () => ({ total_page: 1, record_meetings: [{ meeting_id: "m-1", record_files: files }] }),
  });
  const validParagraph = (pid, text = `p${pid}`) => ({
    pid: String(pid), start_time: pid * 1000, end_time: pid * 1000 + 500,
    sentences: [{ words: [{ text }] }],
  });

  test("follows transcript `more` pages by the next paragraph id and retains every paragraph", async () => {
    const calls = [];
    const client = createTencentClient({
      config: connectorConfig({ transcript: "supported" }), now: () => 1_700_000_000_000, nonce: () => 1,
      fetchImpl: async (url) => {
        const parsed = new URL(url); calls.push(parsed);
        if (parsed.pathname === "/v1/records") return recordsResponse();
        if (parsed.pathname === "/v1/records/transcripts/details") {
          const pid = parsed.searchParams.get("pid");
          return { ok: true, status: 200, json: async () => pid === null
            ? { more: true, minutes: { paragraphs: [validParagraph(0), validParagraph(1)] } }
            : { more: false, minutes: { paragraphs: [validParagraph(2)] } } };
        }
        throw new Error("unexpected endpoint");
      },
    });
    const content = await client.getContent("m-1", { meetingStartTime: 1_700_000_000_000, meetingEndTime: 1_700_086_400_000 });
    const transcriptCalls = calls.filter((url) => url.pathname === "/v1/records/transcripts/details");
    expect(transcriptCalls.map((url) => url.searchParams.get("pid"))).toEqual([null, "2"]);
    expect(content.segments.map((segment) => segment.text)).toEqual(["p0", "p1", "p2"]);
    expect(content.transcript).toBe("p0\np1\np2");
  });

  test("rejects transcript pagination that repeats or fails to advance its pid", async () => {
    const client = createTencentClient({
      config: connectorConfig({ transcript: "supported" }), now: () => 1_700_000_000_000, nonce: () => 1,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/v1/records") return recordsResponse();
        return { ok: true, status: 200, json: async () => ({ more: true, minutes: { paragraphs: [validParagraph(0)] } }) };
      },
    });
    await expect(client.getContent("m-1", { meetingStartTime: 1_700_000_000_000, meetingEndTime: 1_700_086_400_000 }))
      .rejects.toMatchObject({ code: "TENCENT_INVALID_RESPONSE" });
  });

  test("rejects an empty continuation page even when it clears `more`", async () => {
    const client = createTencentClient({
      config: connectorConfig({ transcript: "supported" }), now: () => 1_700_000_000_000, nonce: () => 1,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/v1/records") return recordsResponse();
        return { ok: true, status: 200, json: async () => parsed.searchParams.has("pid")
          ? { more: false, minutes: { paragraphs: [] } }
          : { more: true, minutes: { paragraphs: [validParagraph(0)] } } };
      },
    });
    await expect(client.getContent("m-1", { meetingStartTime: 1_700_000_000_000, meetingEndTime: 1_700_086_400_000 }))
      .rejects.toMatchObject({ code: "TENCENT_INVALID_RESPONSE" });
  });

  test("aggregates mixed recording transcript and smart minutes without losing provenance", async () => {
    const base = 1_700_000_000_000;
    const files = [
      { record_file_id: "rf-1", record_start_time: base, record_end_time: base + 1000 },
      { record_file_id: "rf-2", record_start_time: base + 5000, record_end_time: base + 6000 },
    ];
    const client = createTencentClient({
      config: connectorConfig({ transcript: "supported", summary: "supported" }), now: () => base, nonce: () => 1,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/v1/records") return recordsResponse(files);
        if (parsed.pathname === "/v1/records/transcripts/details") {
          if (parsed.searchParams.get("record_file_id") === "rf-2") return { ok: false, status: 500, json: async () => ({ error_code: 30001 }) };
          return { ok: true, status: 200, json: async () => ({ more: false, minutes: { paragraphs: [validParagraph(0, "rf-1")] } }) };
        }
        if (parsed.pathname.startsWith("/v1/smart/minutes/")) return { ok: true, status: 200, json: async () => parsed.pathname.endsWith("rf-1")
          ? { meeting_minute: { minute: "summary one" } }
          : { meeting_minute: { minute: "" } } };
        throw new Error("unexpected endpoint");
      },
    });
    const content = await client.getContent("m-1", { meetingStartTime: base, meetingEndTime: base + 86_400_000 });
    expect(content.transcript).toBe("rf-1");
    expect(content.summary).toBe("summary one");
    expect(content.summarySegments).toEqual([{ text: "summary one", location: { type: "paragraph", paragraph: 0, recordFileId: "rf-1" } }]);
    expect(content.capabilities).toMatchObject({ transcript: { status: "supported" }, summary: { status: "supported" } });
  });

  test.each([
    ["record list", "/v1/records", {}],
    ["transcript envelope", "/v1/records/transcripts/details", { more: false }],
    ["paragraph list", "/v1/records/transcripts/details", { more: false, minutes: {} }],
  ])("rejects a malformed successful %s response", async (_label, malformedPath, body) => {
    const client = createTencentClient({
      config: connectorConfig({ transcript: "supported" }), now: () => 1_700_000_000_000, nonce: () => 1,
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname === "/v1/records" && malformedPath !== pathname) return recordsResponse();
        if (pathname === malformedPath) return { ok: true, status: 200, json: async () => body };
        throw new Error("unexpected endpoint");
      },
    });
    await expect(client.getContent("m-1", { meetingStartTime: 1_700_000_000_000, meetingEndTime: 1_700_086_400_000 }))
      .rejects.toMatchObject({ code: "TENCENT_INVALID_RESPONSE" });
  });

  test("marks an empty downloadable-artifact discovery explicitly absent", async () => {
    const client = createTencentClient({
      config: connectorConfig({ attachments: "supported" }), now: () => 1_700_000_000_000, nonce: () => 1,
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname === "/v1/records") return recordsResponse();
        if (pathname.startsWith("/v1/addresses/")) return { ok: true, status: 200, json: async () => ({ ai_minutes: [] }) };
        throw new Error("unexpected endpoint");
      },
    });
    const content = await client.getContent("m-1", { meetingStartTime: 1_700_000_000_000, meetingEndTime: 1_700_086_400_000 });
    expect(content.attachments).toEqual([]);
    expect(content.capabilities.attachments).toMatchObject({ status: "absent" });
    expect(content.capabilities.attachments.reason).toMatch(/no downloadable artifacts/i);
  });

  test("rejects a malformed successful smart-minutes envelope instead of treating it as absence", async () => {
    const client = createTencentClient({
      config: connectorConfig({ summary: "supported" }), now: () => 1_700_000_000_000, nonce: () => 1,
      fetchImpl: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname === "/v1/records") return recordsResponse();
        if (parsed.pathname.startsWith("/v1/smart/minutes/")) return { ok: true, status: 200, json: async () => ({}) };
        throw new Error("unexpected endpoint");
      },
    });
    await expect(client.getContent("m-1", { meetingStartTime: 1_700_000_000_000, meetingEndTime: 1_700_086_400_000 }))
      .rejects.toMatchObject({ code: "TENCENT_INVALID_RESPONSE" });
  });

  test("enforces timeout through a stalled body and validates final redirect host", async () => {
    const stalled = createTencentClient({
      config: connectorConfig(), timeoutMs: 15,
      fetchImpl: async (_url, { signal }) => ({
        ok: true, status: 200, url: "https://download.tencent.com/file",
        headers: { get: () => null },
        body: { getReader: () => ({ read: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true })), cancel: async () => {} }) },
      }),
    });
    await expect(stalled.downloadAttachment("https://download.tencent.com/file"))
      .rejects.toMatchObject({ code: "TENCENT_TIMEOUT" });
    const redirected = createTencentClient({
      config: connectorConfig(), fetchImpl: async () => ({ ok: true, status: 200, url: "https://evil.example/file", headers: { get: () => "1" }, arrayBuffer: async () => Uint8Array.from([1]).buffer }),
    });
    await expect(redirected.downloadAttachment("https://download.tencent.com/file"))
      .rejects.toMatchObject({ code: "INVALID_TENCENT_DOWNLOAD_URL" });
  });
});
