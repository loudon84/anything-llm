const crypto = require("crypto");
const { MeetingError } = require("./errors");
const { REVIEW, RETRIEVAL, quarterFor, LIMITS } = require("./policy");
const { syncActionCandidates } = require("./actionItems");

const PAGE_SIZE = 100;
const GROUPS = [
  "meeting_summary",
  "ai_meeting_transcripts",
  "ai_minutes",
  "ai_topic_minutes",
  "ai_speaker_minutes",
  "ai_ds_minutes",
];
const OPTIONAL_GROUPS = new Set(GROUPS.slice(2));
const EXTENSIONS = new Set(["txt", "md", "pdf", "docx", "png", "jpg", "jpeg", "webp", "xlsx", "pptx"]);
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function fail(code, status = 502) {
  return new MeetingError("Meeting Gateway content could not be imported", code, status);
}

function validDownloadUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password &&
      /(?:^|\.)(?:tencent\.com|qcloud\.com|myqcloud\.com)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function safeExtension(value) {
  if (value == null || value === "") return "txt";
  if (typeof value !== "string") throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
  const extension = value.toLowerCase().replace(/^\./, "");
  if (!EXTENSIONS.has(extension)) throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
  return extension;
}

function normalizeGroups(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
  for (const key of Object.keys(raw)) {
    if ((key.startsWith("ai_") || key === "meeting_summary") && !GROUPS.includes(key))
      throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
  }
  const artifacts = [];
  for (const group of GROUPS) {
    const rows = raw[group];
    if (rows == null) continue;
    if (!Array.isArray(rows)) throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
    rows.forEach((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row) ||
          (row.download_address != null && typeof row.download_address !== "string") ||
          (row.file_type != null && typeof row.file_type !== "string"))
        throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
      if (!row.download_address) return;
      if (!validDownloadUrl(row.download_address)) throw fail("MGW_DOWNLOAD_URL_REJECTED");
      artifacts.push({ group, index, extension: safeExtension(row.file_type), url: row.download_address });
    });
  }
  return artifacts;
}

function createGatewayImporter({
  prisma,
  gatewayClient,
  parser,
  fetchImpl = global.fetch,
  authService,
  gatewaySessions,
  meetingAuthAccess,
  credentialVault,
  storageRoot,
  clock = () => new Date(),
} = {}) {
  if (!prisma || !gatewayClient || !parser) throw new TypeError("Gateway importer dependencies are required");

  async function transaction(callback) {
    return prisma.$transaction ? prisma.$transaction(callback) : callback(prisma);
  }

  async function currentContext(payload) {
    const context = payload?.authContext;
    if (!context || !["GATEWAY_SESSION", "GATEWAY_BRIDGE"].includes(context.kind) ||
        !Number.isSafeInteger(Number(context.userId)) || Number(context.userId) <= 0 ||
        typeof context.sessionId !== "string" || !Number.isSafeInteger(Number(context.credentialEpoch)))
      throw fail("MGW_BUSINESS_AUTH_REQUIRED", 401);
    const trusted = context.kind === "GATEWAY_BRIDGE"
      ? await gatewaySessions?.getValidatedBridgeActor(context)
      : await authService?.getValidatedSessionActor({
          sessionId: context.sessionId,
          userId: Number(context.userId),
          credentialEpoch: Number(context.credentialEpoch),
        });
    if (!trusted) throw fail("MGW_BUSINESS_AUTH_REQUIRED", 401);
    meetingAuthAccess?.assertRemoteAllowed({ authState: trusted, action: "job.GATEWAY_IMPORT" });
    if (!trusted?.authenticated || Number(trusted.actor?.userId) !== Number(context.userId))
      throw fail("MGW_BUSINESS_AUTH_REQUIRED", 401);
    if (!credentialVault?.openForJob)
      throw fail("MGW_SESSION_CREDENTIALS_UNAVAILABLE", 503);
    const accessToken = await credentialVault.openForJob(payload.jobId, context);
    if (typeof accessToken !== "string" || !accessToken.startsWith("mt_"))
      throw fail("MGW_BUSINESS_AUTH_REQUIRED", 401);
    return { trusted, accessToken };
  }

  async function download(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetchImpl(url, { method: "GET", redirect: "error", signal: controller.signal });
      if (!response?.ok) throw fail("MGW_DOWNLOAD_FAILED");
      if (response.url && !validDownloadUrl(response.url)) throw fail("MGW_DOWNLOAD_URL_REJECTED");
      const advertised = Number(response.headers?.get?.("content-length"));
      if (Number.isFinite(advertised) && advertised > LIMITS.fileBytes) throw fail("MGW_DOWNLOAD_TOO_LARGE", 413);
      if (!response.body?.getReader) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength > LIMITS.fileBytes) throw fail("MGW_DOWNLOAD_TOO_LARGE", 413);
        return buffer;
      }
      const reader = response.body.getReader();
      const chunks = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > LIMITS.fileBytes) {
          await reader.cancel();
          throw fail("MGW_DOWNLOAD_TOO_LARGE", 413);
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks, length);
    } catch (error) {
      if (error instanceof MeetingError) throw error;
      throw fail(error?.name === "AbortError" ? "MGW_DOWNLOAD_TIMEOUT" : "MGW_DOWNLOAD_FAILED");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function allRecordFiles({ accessToken, row }) {
    const result = [];
    const seenIds = new Set();
    const cursors = new Set();
    let pos = 0;
    while (true) {
      if (cursors.has(pos)) throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
      cursors.add(pos);
      const page = await gatewayClient.getMeetingRecordFiles({
        gatewayAccessToken: accessToken,
        connectionRef: row.connection_ref,
        meetingId: row.gateway_meeting_id,
        pos,
        size: PAGE_SIZE,
      });
      if (!page || page.meetingId !== row.gateway_meeting_id || page.pos !== pos ||
          page.size !== PAGE_SIZE || typeof page.hasRemaining !== "boolean" || !Array.isArray(page.items) ||
          (page.hasRemaining && (!Number.isSafeInteger(page.nextPos) || page.nextPos <= pos)) ||
          (!page.hasRemaining && page.nextPos !== null)) throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
      for (const item of page.items) {
        if (!item || typeof item.recordFileId !== "string" || !item.recordFileId.trim())
          throw fail("MGW_UPSTREAM_CONTRACT_ERROR");
        if (seenIds.has(item.recordFileId)) continue;
        seenIds.add(item.recordFileId);
        result.push(item.recordFileId);
      }
      if (!page.hasRemaining) break;
      pos = page.nextPos;
    }
    if (!result.length) throw fail("MGW_RECORDINGS_EMPTY", 409);
    return result;
  }

  async function ensureMeeting(row, ownerUserId) {
    if (row.local_meeting_id != null) {
      const existing = await prisma.meetings.findUnique({ where: { id: row.local_meeting_id } });
      if (!existing || Number(existing.createdBy) !== ownerUserId || existing.connectionId != null)
        throw fail("MGW_RESOURCE_NOT_ACCESSIBLE", 403);
      return existing;
    }
    return transaction(async (tx) => {
      const again = await tx.meeting_gateway_meetings.findFirst({ where: { id: row.id, anything_user_id: ownerUserId } });
      if (again?.local_meeting_id != null) {
        const linked = await tx.meetings.findUnique({ where: { id: again.local_meeting_id } });
        if (!linked || Number(linked.createdBy) !== ownerUserId || linked.connectionId != null)
          throw fail("MGW_RESOURCE_NOT_ACCESSIBLE", 403);
        return linked;
      }
      const activeKey = `GATEWAY:${row.id}`;
      const existing = await tx.meetings.findUnique({ where: { activeKey } });
      if (existing) {
        if (Number(existing.createdBy) !== ownerUserId || existing.connectionId != null)
          throw fail("MGW_RESOURCE_NOT_ACCESSIBLE", 403);
        await tx.meeting_gateway_meetings.update({ where: { id: row.id }, data: { local_meeting_id: existing.id } });
        return existing;
      }
      const startTime = new Date(row.start_time || clock());
      const meeting = await tx.meetings.create({ data: {
        connectionId: null,
        externalId: row.gateway_meeting_id,
        activeKey,
        title: row.title || row.meeting_code,
        startTime,
        endTime: row.end_time ? new Date(row.end_time) : null,
        quarter: quarterFor(startTime),
        reviewStatus: REVIEW.DRAFT,
        retrievalStatus: RETRIEVAL.WAITING_CONTENT,
        summary: null,
        transcript: null,
        coverage: "{}",
        generation: 0,
        createdBy: ownerUserId,
      } });
      await tx.meeting_gateway_meetings.update({ where: { id: row.id }, data: { local_meeting_id: meeting.id } });
      return meeting;
    });
  }

  async function recordFileArtifacts(accessToken, row, recordFileId) {
    const raw = await gatewayClient.getMeetingRecordFileDetails({
      gatewayAccessToken: accessToken,
      connectionRef: row.connection_ref,
      recordFileId,
    });
    const descriptors = normalizeGroups(raw);
    const parsed = [];
    for (const descriptor of descriptors) {
      const buffer = await download(descriptor.url);
      const segments = await parser.parse({ name: `${recordFileId}.${descriptor.extension}`, buffer });
      if (!Array.isArray(segments) || !segments.length) throw fail("MGW_CONTENT_EMPTY", 409);
      const text = segments.map((segment) => segment.text).filter((value) => typeof value === "string" && value.trim()).join("\n");
      if (!text.trim()) throw fail("MGW_CONTENT_EMPTY", 409);
      parsed.push({ ...descriptor, segments, text, contentHash: sha256(text) });
    }
    return parsed;
  }

  async function saveRecordSources(tx, meeting, recordFileId, artifacts, userId) {
    const savedArtifacts = [];
    for (const artifact of artifacts) {
      const originKey = `gateway:${recordFileId}:${artifact.group}:${artifact.index}`;
      const existing = await tx.meeting_sources.findFirst({ where: { meetingId: meeting.id, originKey } });
      if (existing) {
        let segments;
        try { segments = JSON.parse(existing.segments || "[]"); } catch { throw fail("MGW_SOURCE_CONFLICT", 409); }
        const expectedType = artifact.group === "meeting_summary" ? "SUMMARY" :
          artifact.group === "ai_meeting_transcripts" ? "TRANSCRIPT" : "GATEWAY_ARTIFACT";
        if (existing.sourceType !== expectedType || !existing.contentHash ||
            typeof existing.contentText !== "string" || !existing.contentText.trim() ||
            !Array.isArray(segments) || !segments.length)
          throw fail("MGW_SOURCE_CONFLICT", 409);
        // The stable origin is already the persisted provenance for this artifact.
        // Reuse its exact parsed bytes on retry, never combine an old source row with
        // newly downloaded text under the same origin key.
        savedArtifacts.push({ ...artifact, text: existing.contentText, contentHash: existing.contentHash, segments });
        continue;
      }
      await tx.meeting_sources.create({
        data: {
          meetingId: meeting.id,
          originKey,
          sourceType: artifact.group === "meeting_summary" ? "SUMMARY" :
            artifact.group === "ai_meeting_transcripts" ? "TRANSCRIPT" : "GATEWAY_ARTIFACT",
          name: `${recordFileId}.${artifact.extension}`,
          contentHash: artifact.contentHash,
          activeHash: `GATEWAY:${originKey}`,
          bytes: 0,
          contentText: artifact.text,
          segments: JSON.stringify(artifact.segments.map((segment) => ({
            ...segment,
            location: { ...(segment.location || {}), recordFileId },
          }))),
          parseStatus: "SUCCESS",
          error: null,
          createdBy: userId,
        },
      });
      savedArtifacts.push(artifact);
    }
    return savedArtifacts;
  }

  async function process(job) {
    if (!job || job.kind !== "GATEWAY_IMPORT") throw fail("MGW_IMPORT_JOB_INVALID", 400);
    let payload;
    try { payload = JSON.parse(job.payload || "{}"); } catch { throw fail("MGW_IMPORT_JOB_INVALID", 400); }
    if (Object.keys(payload).some((key) => !["directoryId", "authContext"].includes(key)) ||
        typeof payload.directoryId !== "string") throw fail("MGW_IMPORT_JOB_INVALID", 400);
    const { trusted, accessToken } = await currentContext({ ...payload, jobId: job.id });
    const ownerUserId = Number(trusted.actor.userId);
    const row = await prisma.meeting_gateway_meetings.findFirst({
      where: { id: payload.directoryId, anything_user_id: ownerUserId },
    });
    if (!row) throw fail("MGW_RESOURCE_NOT_ACCESSIBLE", 403);
    if (row.import_status === "IMPORTED" && row.local_meeting_id != null)
      return { localMeetingId: row.local_meeting_id, imported: true, alreadyImported: true };
    if (!meetingAuthAccess?.assertRemoteAllowed) throw fail("MGW_BUSINESS_AUTH_REQUIRED", 401);
    const recordFileIds = await allRecordFiles({ accessToken, row });
    const meeting = await ensureMeeting(row, ownerUserId);
    const allArtifacts = [];
    const failures = [];
    for (const recordFileId of recordFileIds) {
      try {
        const artifacts = await recordFileArtifacts(accessToken, row, recordFileId);
        const persistedArtifacts = await transaction(async (tx) => {
          const effective = await saveRecordSources(tx, meeting, recordFileId, artifacts, ownerUserId);
          await tx.meeting_gateway_import_files.upsert({
            where: { gateway_meeting_id_record_file_id: { gateway_meeting_id: row.id, record_file_id: recordFileId } },
            create: { gateway_meeting_id: row.id, record_file_id: recordFileId, status: "SUCCESS", error_code: null },
            update: { status: "SUCCESS", error_code: null },
          });
          return effective;
        });
        allArtifacts.push(...persistedArtifacts);
      } catch (error) {
        const code = /^MGW_[A-Z0-9_]+$/.test(String(error?.code || "")) ? error.code : "MGW_UPSTREAM_UNAVAILABLE";
        failures.push(code);
        await prisma.meeting_gateway_import_files.upsert({
          where: { gateway_meeting_id_record_file_id: { gateway_meeting_id: row.id, record_file_id: recordFileId } },
          create: { gateway_meeting_id: row.id, record_file_id: recordFileId, status: "FAILED", error_code: code },
          update: { status: "FAILED", error_code: code },
        });
      }
    }
    const summary = allArtifacts.filter((item) => item.group === "meeting_summary").map((item) => item.text).join("\n\n").trim();
    const transcript = allArtifacts.filter((item) => item.group === "ai_meeting_transcripts").map((item) => item.text).join("\n\n").trim();
    if (failures.length) throw fail(failures[0]);
    if (!summary || !transcript) throw fail(!summary ? "MGW_SUMMARY_MISSING" : "MGW_TRANSCRIPT_MISSING", 409);
    const summaryHash = sha256(summary);
    const transcriptHash = sha256(transcript);
    let reindexJob;
    await transaction(async (tx) => {
      const currentDirectory = await tx.meeting_gateway_meetings.findFirst({ where: { id: row.id, anything_user_id: ownerUserId } });
      const currentMeeting = await tx.meetings.findUnique({ where: { id: meeting.id } });
      if (!currentDirectory || !currentMeeting || Number(currentMeeting.createdBy) !== ownerUserId)
        throw fail("MGW_RESOURCE_NOT_ACCESSIBLE", 403);
      const oldSummaryHash = currentDirectory.imported_summary_hash;
      const oldTranscriptHash = currentDirectory.imported_transcript_hash;
      const editedBeforeFirstImport = !oldSummaryHash && !oldTranscriptHash &&
        (Number(currentMeeting.generation || 0) > 0 ||
          Boolean(currentMeeting.summary?.trim()) || Boolean(currentMeeting.transcript?.trim()));
      if (editedBeforeFirstImport ||
          (oldSummaryHash && oldSummaryHash !== sha256(currentMeeting.summary || "")) ||
          (oldTranscriptHash && oldTranscriptHash !== sha256(currentMeeting.transcript || "")))
        throw fail("MGW_IMPORT_EDIT_CONFLICT", 409);
      const generation = Number(currentMeeting.generation || 0) + 1;
      await tx.meetings.update({ where: { id: meeting.id }, data: {
        summary, transcript, generation, retrievalStatus: RETRIEVAL.INDEXING,
      } });
      reindexJob = await tx.meeting_jobs.create({ data: {
        kind: "REINDEX", meetingId: meeting.id, connectionId: null,
        externalId: meeting.externalId, quarter: meeting.quarter,
        activeKey: `REINDEX:${meeting.id}:${generation}:GATEWAY`,
        payload: JSON.stringify({ generation, authContext: payload.authContext }),
        status: "CREATED", attempts: 0,
      } });
      await tx.meeting_gateway_meetings.update({ where: { id: row.id }, data: {
        local_meeting_id: meeting.id, import_status: "IMPORTED", import_error_code: null,
        imported_summary_hash: summaryHash, imported_transcript_hash: transcriptHash,
      } });
      await credentialVault.remove(tx, job.id);
    });
    try {
      await syncActionCandidates(meeting.id, { prisma });
    } catch (error) {
      console.warn(
        "[gatewayImporter] action candidate sync failed after import",
        error?.code || error?.message || error
      );
    }
    return { localMeetingId: meeting.id, imported: true, reindexJobId: reindexJob.id };
  }

  async function markFailed(job, error) {
    let payload = {};
    try { payload = JSON.parse(job?.payload || "{}"); } catch {}
    const code = /^MGW_[A-Z0-9_]+$/.test(String(error?.code || "")) ? error.code : "MGW_UPSTREAM_UNAVAILABLE";
    const context = payload.authContext;
    const ownerUserId = Number(context?.userId);
    if (!Number.isSafeInteger(ownerUserId) || ownerUserId <= 0 || typeof payload.directoryId !== "string") return;
    await prisma.meeting_gateway_meetings.updateMany({
      where: { id: payload.directoryId, anything_user_id: ownerUserId, import_status: "IMPORTING" },
      data: { import_status: "NOT_IMPORTED", import_error_code: code },
    });
    await credentialVault?.remove(prisma, job.id);
  }

  return { process, markFailed, allRecordFiles, normalizeGroups };
}

module.exports = { createGatewayImporter, normalizeGroups, validDownloadUrl, PAGE_SIZE, GROUPS };
