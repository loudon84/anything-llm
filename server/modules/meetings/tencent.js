const crypto = require("crypto");
const { MeetingError } = require("./errors");

const API_ORIGIN = "https://api.meeting.qq.com";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_FILE_BYTES = 100_000_000;
const TRANSCRIPT_PAGE_SIZE = 100;

function invalidResponse() {
  return new MeetingError(
    "Tencent Meeting returned an invalid response",
    "TENCENT_INVALID_RESPONSE",
    502
  );
}

function isAllowedDownloadUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      /(?:^|\.)(?:tencent\.com|qcloud\.com|myqcloud\.com)$/i.test(url.hostname)
    );
  } catch {
    return false;
  }
}

function toUnixSeconds(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0)
    return Math.floor(numeric > 10_000_000_000 ? numeric / 1000 : numeric);
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed))
    throw new MeetingError(
      "A valid Tencent Meeting time range is required",
      "INVALID_IMPORT_SCOPE"
    );
  return Math.floor(parsed / 1000);
}

function toIso(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  const date = Number.isFinite(number)
    ? new Date(number > 10_000_000_000 ? number : number * 1000)
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function canonicalSignature({
  secretId,
  secretKey,
  method,
  nonce,
  timestamp,
  uri,
  body = "",
}) {
  const headerString = `X-TC-Key=${secretId}&X-TC-Nonce=${nonce}&X-TC-Timestamp=${timestamp}`;
  const text = `${method}\n${headerString}\n${uri}\n${body}`;
  const hex = crypto
    .createHmac("sha256", secretKey)
    .update(text, "utf8")
    .digest("hex");
  return Buffer.from(hex, "utf8").toString("base64");
}

function createTencentClient({
  config = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = Date.now,
  nonce,
} = {}) {
  if (typeof fetchImpl !== "function")
    throw new TypeError("createTencentClient requires fetch");
  if (!config.secretId || !config.secretKey || !config.appId) {
    throw new MeetingError(
      "Tencent Meeting AK/SK credentials and enterprise AppId are required",
      "MEETING_CONNECTION_UNCONFIGURED",
      400
    );
  }
  const randomNonce = nonce || (() => crypto.randomInt(1, 2_147_483_647));
  const capabilities = config.capabilities || {};

  async function request(
    path,
    { method = "GET", body = "", download = false, urlOverride } = {}
  ) {
    const target = urlOverride
      ? new URL(urlOverride)
      : new URL(path, API_ORIGIN);
    if (
      urlOverride
        ? !isAllowedDownloadUrl(target.toString())
        : target.protocol !== "https:"
    ) {
      throw new MeetingError(
        "Tencent returned an unsupported download address",
        "INVALID_TENCENT_DOWNLOAD_URL",
        502
      );
    }
    const uri = `${target.pathname}${target.search}`;
    const timestamp = String(Math.floor(now() / 1000));
    const requestNonce = String(randomNonce());
    const headers = urlOverride
      ? {}
      : {
          "Content-Type": "application/json",
          "X-TC-Key": String(config.secretId),
          "X-TC-Timestamp": timestamp,
          "X-TC-Nonce": requestNonce,
          "X-TC-Signature": canonicalSignature({
            secretId: String(config.secretId),
            secretKey: String(config.secretKey),
            method,
            nonce: requestNonce,
            timestamp,
            uri,
            body,
          }),
          AppId: String(config.appId),
          "X-TC-Registered": "1",
        };
    if (!urlOverride && config.sdkId) headers.SdkId = String(config.sdkId);
    if (!urlOverride && config.stsToken)
      headers["STS-Token"] = String(config.stsToken);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let transferOwnsTimeout = false;
    try {
      const response = await fetchImpl(target.toString(), {
        method,
        headers,
        ...(body ? { body } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        let apiCode = null;
        try {
          const errorBody = await response.json();
          apiCode = errorBody.error_code ?? errorBody.code ?? null;
        } catch {
          /* keep upstream error details private */
        }
        const error = new MeetingError(
          `Tencent Meeting request failed (HTTP ${response.status})`,
          "TENCENT_API_FAILURE",
          502
        );
        error.apiCode = apiCode == null ? null : String(apiCode);
        throw error;
      }
      if (download) {
        transferOwnsTimeout = true;
        return { response, controller, timeout, initialUrl: target.toString() };
      }
      try {
        return await response.json();
      } catch {
        throw invalidResponse();
      }
    } catch (error) {
      if (error instanceof MeetingError) throw error;
      if (error?.name === "AbortError" || controller.signal.aborted)
        throw new MeetingError(
          "Tencent Meeting request timed out",
          "TENCENT_TIMEOUT",
          504
        );
      throw new MeetingError(
        "Tencent Meeting request failed",
        "TENCENT_API_FAILURE",
        502
      );
    } finally {
      if (!transferOwnsTimeout) clearTimeout(timeout);
    }
  }

  async function listMeetings(query = {}) {
    const userId = config.userId;
    if (!userId)
      throw new MeetingError(
        "Tencent operator user ID is required",
        "MEETING_CONNECTION_UNCONFIGURED",
        400
      );
    const from = toUnixSeconds(query.from ?? query.startTime);
    const to = toUnixSeconds(query.to ?? query.endTime);
    if (to <= from || to - from > 90 * 24 * 60 * 60) {
      throw new MeetingError(
        "Tencent history search must be a positive interval of at most 90 days",
        "INVALID_IMPORT_SCOPE"
      );
    }
    const page = Math.max(1, Number.parseInt(query.cursor || "1", 10) || 1);
    const params = new URLSearchParams({
      page_size: "20",
      page: String(page),
      start_time: String(from),
      end_time: String(to),
    });
    const data = await request(
      `/v1/history/meetings/${encodeURIComponent(userId)}?${params}`
    );
    if (
      !data ||
      !Array.isArray(data.meeting_info_list) ||
      !Number.isInteger(Number(data.total_page)) ||
      Number(data.total_page) < 1
    )
      throw invalidResponse();
    const items = data.meeting_info_list.map((meeting) => {
      if (!meeting || meeting.meeting_id == null || meeting.start_time == null)
        throw invalidResponse();
      const startTime = toIso(meeting.start_time);
      const endTime = toIso(meeting.end_time);
      if (!startTime || (meeting.end_time != null && !endTime))
        throw invalidResponse();
      return {
        externalId: String(meeting.meeting_id),
        title: String(meeting.subject || ""),
        startTime,
        endTime,
      };
    });
    const totalPage = Number(data.total_page);
    return { items, nextCursor: page < totalPage ? String(page + 1) : null };
  }

  async function discoverRecord(externalId, range = {}) {
    const operatorId = config.operatorId || config.userId;
    const operatorIdType = Number(config.operatorIdType || 1);
    const from = toUnixSeconds(range.meetingStartTime ?? range.startTime);
    const to = toUnixSeconds(range.meetingEndTime ?? range.endTime);
    if (to <= from || to - from > 31 * 24 * 60 * 60) {
      throw new MeetingError(
        "Tencent recording search must be a positive interval of at most 31 days",
        "INVALID_IMPORT_SCOPE"
      );
    }
    const recordings = [];
    let recordPage = 1;
    let recordPages = 1;
    while (recordPage <= recordPages) {
      const recordParams = new URLSearchParams({
        operator_id: String(operatorId),
        operator_id_type: String(operatorIdType),
        start_time: String(from),
        end_time: String(to),
        meeting_id: String(externalId),
        page_size: "20",
        page: String(recordPage),
      });
      const records = await request(`/v1/records?${recordParams}`);
      if (
        !records ||
        !Array.isArray(records.record_meetings) ||
        !Number.isInteger(Number(records.total_page)) ||
        Number(records.total_page) < 1
      )
        throw invalidResponse();
      if (Number(records.total_page) < recordPages && recordPage === 1)
        throw invalidResponse();
      for (const record of records.record_meetings) {
        if (!record || !Array.isArray(record.record_files))
          throw invalidResponse();
        for (const file of record.record_files) {
          if (
            !file ||
            file.record_file_id == null ||
            !Number.isFinite(Number(file.record_start_time)) ||
            !Number.isFinite(Number(file.record_end_time))
          )
            throw invalidResponse();
        }
      }
      recordings.push(...records.record_meetings);
      recordPages = Number(records.total_page);
      recordPage += 1;
    }
    const matchingRecords = recordings.filter(
      (item) => String(item.meeting_id) === String(externalId)
    );
    const files = matchingRecords
      .flatMap((item) => item.record_files || [])
      .sort(
        (left, right) =>
          Number(left.record_start_time || 0) -
          Number(right.record_start_time || 0)
      );
    if (
      files.length > 1 &&
      files.some((file) => !Number.isFinite(Number(file.record_start_time)))
    ) {
      throw new MeetingError(
        "Tencent did not return recording start times needed to join multiple transcripts",
        "TENCENT_RECORD_TIMING_MISSING",
        502
      );
    }
    return { matchingRecords, files, from, to, operatorId, operatorIdType };
  }

  async function getContent(externalId, scope = {}) {
    const { files, operatorId, operatorIdType } = await discoverRecord(
      externalId,
      scope
    );
    const timelineStart = files.length ? Number(files[0].record_start_time) : 0;
    const transcriptCapability =
      capabilities.transcript === "supported" ||
      capabilities.transcript?.status === "supported";
    const summaryCapability =
      capabilities.summary === "supported" ||
      capabilities.summary?.status === "supported";
    const attachmentCapability =
      capabilities.attachments === "supported" ||
      capabilities.attachments?.status === "supported";
    const result = {
      summary: null,
      summarySegments: [],
      transcript: null,
      segments: [],
      attachments: [],
      capabilities: {
        transcript: transcriptCapability
          ? { status: "supported" }
          : {
              status: "unsupported",
              reason:
                "Structured transcript retrieval is not enabled for this connection; add transcript text manually if needed.",
            },
        summary: summaryCapability
          ? { status: "supported" }
          : {
              status: "unsupported",
              reason:
                "Summary retrieval is not enabled for this connection. Add minutes manually if needed.",
            },
        attachments: attachmentCapability
          ? { status: "supported" }
          : {
              status: "unsupported",
              reason:
                "Recording artifact downloads are not enabled for this connection. Add files manually if needed.",
            },
      },
    };
    if (!files.length) {
      result.capabilities.transcript = {
        status: "absent",
        reason: "Tencent returned no recording file for this meeting.",
      };
      result.capabilities.summary = {
        status: "absent",
        reason: "Tencent returned no recording file for this meeting.",
      };
      result.capabilities.attachments = {
        status: "absent",
        reason: "Tencent returned no recording file for this meeting.",
      };
      return result;
    }
    let anyTranscript = false;
    let anySummary = false;
    let anyArtifact = false;
    for (const file of files) {
      const fileId = String(file.record_file_id);
      const fileOffsetMs = Math.max(
        0,
        Number(file.record_start_time || timelineStart) - timelineStart
      );
      if (transcriptCapability) {
        try {
          const paragraphs = [];
          let cursor = null;
          const seenParagraphIds = new Set();
          while (true) {
            const transcriptParams = new URLSearchParams({
              record_file_id: fileId,
              meeting_id: String(externalId),
              operator_id: String(operatorId),
              operator_id_type: String(operatorIdType),
              limit: String(TRANSCRIPT_PAGE_SIZE),
              ...(cursor == null ? {} : { pid: cursor }),
            });
            const transcript = await request(
              `/v1/records/transcripts/details?${transcriptParams}`
            );
            if (
              !transcript ||
              typeof transcript.more !== "boolean" ||
              !transcript.minutes ||
              !Array.isArray(transcript.minutes.paragraphs)
            )
              throw invalidResponse();
            const pageParagraphs = transcript.minutes.paragraphs;
            if (cursor != null && !pageParagraphs.length)
              throw invalidResponse();
            for (const paragraph of pageParagraphs) {
              if (
                !paragraph ||
                paragraph.pid == null ||
                !Number.isFinite(Number(paragraph.start_time)) ||
                !Number.isFinite(Number(paragraph.end_time)) ||
                !Array.isArray(paragraph.sentences) ||
                seenParagraphIds.has(String(paragraph.pid))
              )
                throw invalidResponse();
              for (const sentence of paragraph.sentences) {
                if (
                  !sentence ||
                  !Array.isArray(sentence.words) ||
                  sentence.words.some(
                    (word) => !word || typeof word.text !== "string"
                  )
                )
                  throw invalidResponse();
              }
              seenParagraphIds.add(String(paragraph.pid));
              paragraphs.push(paragraph);
            }
            if (!transcript.more) break;
            if (!pageParagraphs.length) throw invalidResponse();
            const lastPid = Number(
              pageParagraphs[pageParagraphs.length - 1].pid
            );
            if (!Number.isSafeInteger(lastPid)) throw invalidResponse();
            const nextCursor = String(lastPid + 1);
            if (
              nextCursor === cursor ||
              (cursor != null && Number(nextCursor) <= Number(cursor))
            )
              throw invalidResponse();
            cursor = nextCursor;
          }
          const segments = paragraphs
            .map((paragraph, index) => ({
              text: (paragraph.sentences || [])
                .map((sentence) =>
                  (sentence.words || []).map((word) => word.text || "").join("")
                )
                .join(""),
              location: {
                type: "transcript",
                paragraph: Number(paragraph.pid ?? index),
                startMs: fileOffsetMs + Number(paragraph.start_time),
                endMs: fileOffsetMs + Number(paragraph.end_time),
                recordFileId: fileId,
              },
            }))
            .filter((segment) => segment.text.trim());
          result.segments.push(...segments);
          anyTranscript ||= segments.length > 0;
        } catch (error) {
          if (
            error.code === "TENCENT_API_FAILURE" &&
            ["30001", "30002", "4049"].includes(error.apiCode)
          ) {
            /* Confirmed per-file absence; keep any transcript found in other recordings. */
          } else throw error;
        }
      }
      if (summaryCapability) {
        const minuteParams = new URLSearchParams({
          operator_id_type: String(operatorIdType),
          operator_id: String(operatorId),
          minute_type: "0",
          text_type: "1",
        });
        const minute = await request(
          `/v1/smart/minutes/${encodeURIComponent(fileId)}?${minuteParams}`
        );
        if (
          !minute ||
          !minute.meeting_minute ||
          typeof minute.meeting_minute.minute !== "string"
        )
          throw invalidResponse();
        const summary = minute.meeting_minute.minute.trim();
        if (summary) {
          anySummary = true;
          result.summarySegments.push({
            text: summary,
            location: { type: "paragraph", paragraph: 0, recordFileId: fileId },
          });
        }
      }
      if (attachmentCapability) {
        const detailParams = new URLSearchParams({
          operator_id: String(operatorId),
          operator_id_type: String(operatorIdType),
        });
        const detail = await request(
          `/v1/addresses/${encodeURIComponent(fileId)}?${detailParams}`
        );
        if (!detail || typeof detail !== "object" || Array.isArray(detail))
          throw invalidResponse();
        for (const type of [
          "meeting_summary",
          "ai_meeting_transcripts",
          "ai_minutes",
          "ai_topic_minutes",
          "ai_speaker_minutes",
          "ai_ds_minutes",
        ]) {
          if (detail[type] != null && !Array.isArray(detail[type]))
            throw invalidResponse();
          for (const artifact of detail[type] || []) {
            if (
              !artifact ||
              typeof artifact !== "object" ||
              (artifact.download_address != null &&
                typeof artifact.download_address !== "string")
            )
              throw invalidResponse();
            if (!artifact.download_address) continue;
            anyArtifact = true;
            result.attachments.push({
              name: `${fileId}.${String(artifact.file_type || "txt")}`,
              downloadUrl: artifact.download_address,
              externalFileId: `${fileId}:${type}:${artifact.file_type || "txt"}`,
              sourceType: "TENCENT_ORIGINAL",
              artifactType: type,
            });
          }
        }
      }
    }
    result.transcript =
      result.segments.map((segment) => segment.text).join("\n") || null;
    result.summary =
      result.summarySegments.map((segment) => segment.text).join("\n\n") ||
      null;
    if (transcriptCapability && !anyTranscript)
      result.capabilities.transcript = {
        status: "absent",
        reason:
          "Tencent returned no generated transcript for any recording in this meeting.",
      };
    if (summaryCapability && !anySummary)
      result.capabilities.summary = {
        status: "absent",
        reason:
          "Tencent returned no generated smart minutes for any recording in this meeting.",
      };
    if (attachmentCapability && !anyArtifact)
      result.capabilities.attachments = {
        status: "absent",
        reason:
          "Tencent returned no downloadable artifacts for any recording in this meeting.",
      };
    return result;
  }

  async function describeMeeting(externalId, range = {}) {
    const { matchingRecords, files, operatorId, operatorIdType } =
      await discoverRecord(externalId, range);
    const transcriptEnabled =
      capabilities.transcript === "supported" ||
      capabilities.transcript?.status === "supported";
    const summaryEnabled =
      capabilities.summary === "supported" ||
      capabilities.summary?.status === "supported";
    const attachmentEnabled =
      capabilities.attachments === "supported" ||
      capabilities.attachments?.status === "supported";
    const manifest = {
      attachments: [],
      transcriptDurationMs: files.reduce(
        (maximum, file) =>
          Math.max(
            maximum,
            Number(file.record_end_time || 0) -
              Number(files[0]?.record_start_time || file.record_start_time || 0)
          ),
        0
      ),
      recordings: files.map((file) => ({
        recordFileId: String(file.record_file_id),
        startOffsetMs:
          Number(file.record_start_time || files[0]?.record_start_time || 0) -
          Number(files[0]?.record_start_time || file.record_start_time || 0),
        durationMs: Math.max(
          0,
          Number(file.record_end_time || 0) -
            Number(file.record_start_time || 0)
        ),
      })),
      capabilities: {
        transcript: transcriptEnabled
          ? { status: files.length ? "supported" : "absent" }
          : {
              status: "unsupported",
              reason:
                "Structured transcript retrieval is not enabled for this connection.",
            },
        summary: summaryEnabled
          ? { status: files.length ? "supported" : "absent" }
          : {
              status: "unsupported",
              reason: "Summary retrieval is not enabled for this connection.",
            },
        attachments: attachmentEnabled
          ? { status: files.length ? "supported" : "absent" }
          : {
              status: "unsupported",
              reason:
                "Recording artifact downloads are not enabled for this connection.",
            },
      },
    };
    if (!matchingRecords.length) return manifest;
    if (attachmentEnabled) {
      for (const file of files) {
        const params = new URLSearchParams({
          operator_id: String(operatorId),
          operator_id_type: String(operatorIdType),
        });
        const detail = await request(
          `/v1/addresses/${encodeURIComponent(file.record_file_id)}?${params}`
        );
        if (!detail || typeof detail !== "object" || Array.isArray(detail))
          throw invalidResponse();
        for (const type of [
          "meeting_summary",
          "ai_meeting_transcripts",
          "ai_minutes",
          "ai_topic_minutes",
          "ai_speaker_minutes",
          "ai_ds_minutes",
        ]) {
          if (detail[type] != null && !Array.isArray(detail[type]))
            throw invalidResponse();
          for (const artifact of detail[type] || []) {
            if (
              !artifact ||
              typeof artifact !== "object" ||
              (artifact.download_address != null &&
                typeof artifact.download_address !== "string")
            )
              throw invalidResponse();
            if (!artifact.download_address) continue;
            const fileType = String(artifact.file_type || "txt");
            manifest.attachments.push({
              externalFileId: `${file.record_file_id}:${type}:${fileType}`,
              name: `${file.record_file_id}.${fileType}`,
              sourceType: "TENCENT_ORIGINAL",
              artifactType: type,
              bytes: null,
              maxBytes: MAX_FILE_BYTES,
            });
          }
        }
      }
      if (!manifest.attachments.length)
        manifest.capabilities.attachments = {
          status: "absent",
          reason:
            "Tencent returned no downloadable artifacts for any recording in this meeting.",
        };
    }
    return manifest;
  }

  async function downloadAttachment(downloadUrl, maxBytes = MAX_FILE_BYTES) {
    const transfer = await request("/", {
      urlOverride: downloadUrl,
      download: true,
    });
    const { response, controller, timeout } = transfer;
    try {
      if (response.url && !isAllowedDownloadUrl(response.url)) {
        await response.body?.cancel?.();
        throw new MeetingError(
          "Tencent returned an unsupported download address",
          "INVALID_TENCENT_DOWNLOAD_URL",
          502
        );
      }
      const advertised = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(advertised) && advertised > maxBytes)
        throw new MeetingError(
          "Tencent artifact exceeds the 100 MB file limit",
          "FILE_SIZE_LIMIT",
          413
        );
      if (!response.body?.getReader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > maxBytes)
          throw new MeetingError(
            "Tencent artifact exceeds the 100 MB file limit",
            "FILE_SIZE_LIMIT",
            413
          );
        return buffer;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new MeetingError(
            "Tencent artifact exceeds the 100 MB file limit",
            "FILE_SIZE_LIMIT",
            413
          );
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, total);
    } catch (error) {
      if (controller.signal.aborted || error?.name === "AbortError")
        throw new MeetingError(
          "Tencent Meeting request timed out",
          "TENCENT_TIMEOUT",
          504
        );
      if (error instanceof MeetingError) throw error;
      throw new MeetingError(
        "Tencent artifact download failed",
        "TENCENT_API_FAILURE",
        502
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return { listMeetings, getContent, describeMeeting, downloadAttachment };
}

module.exports = {
  createTencentClient,
  canonicalSignature,
  toUnixSeconds,
  MAX_FILE_BYTES,
};
