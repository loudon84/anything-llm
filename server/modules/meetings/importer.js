const { MeetingError } = require("./errors");
const { LIMITS } = require("./constants");
const { quarterFor } = require("./policy");
const { createMeetingService } = require("./meetingService");

function parseJson(value, fallback = {}) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value || fallback;
  } catch {
    return fallback;
  }
}

function makeActiveKey(connectionId, externalId) {
  return `${Number(connectionId)}:${String(externalId)}`;
}

function capabilitySnapshot(value) {
  const status = value && typeof value === "object" ? value.status : value;
  const reason = value && typeof value === "object" ? value.reason : null;
  return {
    status: typeof status === "string" ? status : "unknown",
    ...(typeof reason === "string" && reason
      ? { reason: reason.slice(0, 500) }
      : {}),
  };
}

function importCoverage(content = {}, scope = {}) {
  const capabilities = content.capabilities || {};
  const hasRange = scope.from != null || scope.to != null;
  const selectedIds = Array.isArray(scope.attachmentIds)
    ? new Set(scope.attachmentIds.map(String))
    : null;
  const attachments = (content.attachments || []).map((item) => ({
    externalFileId: String(item.externalFileId || "").slice(0, 255),
    name: String(item.name || "").slice(0, 255),
  }));
  return {
    transcript: {
      ...capabilitySnapshot(capabilities.transcript),
      selection: hasRange
        ? {
            mode: "selected",
            from: Number(scope.from ?? 0),
            to: Number(scope.to),
          }
        : { mode: "full" },
    },
    summary: {
      ...capabilitySnapshot(capabilities.summary),
      coverage: "whole_meeting",
      included: Boolean(String(content.summary || "").trim()),
    },
    attachments: {
      ...capabilitySnapshot(capabilities.attachments),
      selection: selectedIds ? "selected" : "all",
      selected: selectedIds
        ? attachments.filter((item) => selectedIds.has(item.externalFileId))
        : attachments,
      excluded: selectedIds
        ? attachments.filter((item) => !selectedIds.has(item.externalFileId))
        : [],
    },
  };
}

function hasSupportedContent(content = {}) {
  if (
    String(content.summary || "").trim() ||
    String(content.transcript || "").trim()
  )
    return true;
  if (
    (content.segments || []).some((segment) =>
      String(segment?.text || "").trim()
    )
  )
    return true;
  return (content.attachments || []).length > 0;
}

function clipContent(content = {}, scope = {}) {
  const hasRange = scope.from != null || scope.to != null;
  const transcriptSegments = (content.segments || []).filter(
    (segment) => segment.location?.type === "transcript"
  );
  const sourceSegments = (content.segments || []).filter(
    (segment) => segment.location?.type !== "transcript"
  );
  if (String(content.transcript || "").trim() && !transcriptSegments.length) {
    throw new MeetingError(
      "Tencent transcript has no timestamps; its duration cannot be verified",
      "TRANSCRIPT_TIMESTAMPS_REQUIRED"
    );
  }
  const bounds = transcriptSegments.map((segment) => ({
    start: Number(segment.location.startMs),
    end: Number(segment.location.endMs),
  }));
  if (
    bounds.some(
      ({ start, end }) =>
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end <= start
    )
  ) {
    throw new MeetingError(
      "Tencent transcript returned invalid time bounds",
      "TRANSCRIPT_TIMESTAMPS_INVALID"
    );
  }
  const segmentEnd = bounds.reduce(
    (maximum, { end }) => Math.max(maximum, end),
    0
  );
  const reportedDuration =
    content.transcriptDurationMs == null
      ? null
      : Number(content.transcriptDurationMs);
  if (
    reportedDuration != null &&
    (!Number.isFinite(reportedDuration) || reportedDuration < 0)
  ) {
    throw new MeetingError(
      "Tencent returned invalid transcript duration metadata",
      "TRANSCRIPT_TIMESTAMPS_INVALID"
    );
  }
  const transcriptDuration = reportedDuration ?? segmentEnd;
  if (
    reportedDuration != null &&
    bounds.some(({ end }) => end > reportedDuration)
  ) {
    throw new MeetingError(
      "Tencent transcript segment exceeds the authoritative transcript duration",
      "TRANSCRIPT_SCOPE_OUT_OF_RANGE"
    );
  }
  if (String(content.transcript || "").trim() || transcriptSegments.length) {
    if (!hasRange && transcriptDuration > LIMITS.transcriptDurationMs)
      throw new MeetingError(
        "Full transcript exceeds the three-hour import limit; select a shorter interval",
        "TRANSCRIPT_SCOPE_LIMIT"
      );
  }
  if (!hasRange) return content;
  const from = Number(scope.from ?? 0);
  const to = Number(scope.to);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to <= from ||
    to - from > LIMITS.transcriptDurationMs
  ) {
    throw new MeetingError(
      "Transcript selection must be a positive interval of no more than three hours",
      "TRANSCRIPT_SCOPE_LIMIT"
    );
  }
  if (reportedDuration == null && !bounds.length) {
    throw new MeetingError(
      "Tencent did not return transcript duration needed to validate this selection",
      "TRANSCRIPT_TIMESTAMPS_REQUIRED"
    );
  }
  if (to > transcriptDuration || from >= transcriptDuration) {
    throw new MeetingError(
      "Transcript selection exceeds the transcript returned by Tencent",
      "TRANSCRIPT_SCOPE_OUT_OF_RANGE"
    );
  }
  const selected = transcriptSegments.filter((segment) => {
    const start = Number(segment.location.startMs);
    const end = Number(segment.location.endMs);
    return (
      Number.isFinite(start) && Number.isFinite(end) && start < to && end > from
    );
  });
  return {
    ...content,
    transcript: selected.map((segment) => segment.text).join("\n"),
    segments: [...sourceSegments, ...selected],
  };
}

function createImporter({
  prisma,
  meetingService,
  clientFactory,
  sourceService,
  configService,
  audit = async () => {},
} = {}) {
  if (
    !prisma ||
    !meetingService ||
    typeof clientFactory !== "function" ||
    !sourceService
  ) {
    throw new TypeError(
      "createImporter requires prisma, meetingService, clientFactory and sourceService"
    );
  }

  async function connectionConfig(connection) {
    if (configService?.getPrivate)
      return configService.getPrivate(connection.id);
    const stored = parseJson(connection.config);
    return { ...stored.settings, ...stored };
  }

  async function assertCurrentLease(db, job) {
    if (!job.leaseOwner) return;
    const current = await db.meeting_jobs.findUnique({ where: { id: job.id } });
    if (
      !current ||
      current.status !== "PROCESSING" ||
      current.leaseOwner !== job.leaseOwner
    ) {
      throw new MeetingError(
        "Import lease expired before the job could commit",
        "IMPORT_LEASE_LOST",
        409
      );
    }
  }

  async function setStage(job, stage) {
    const updated = await prisma.meeting_jobs.updateMany({
      where: {
        id: job.id,
        status: job.leaseOwner ? "PROCESSING" : "CREATED",
        leaseOwner: job.leaseOwner ?? null,
      },
      data: { stage },
    });
    if (updated.count !== 1)
      throw new MeetingError(
        "Import lease expired before the job could continue",
        "IMPORT_LEASE_LOST",
        409
      );
  }

  async function completeJob(db, job, data) {
    const where = job.leaseOwner
      ? { id: job.id, status: "PROCESSING", leaseOwner: job.leaseOwner }
      : { id: job.id, status: "CREATED", leaseOwner: null };
    const result = await db.meeting_jobs.updateMany({ where, data });
    if (result.count !== 1)
      throw new MeetingError(
        "Import lease expired before the job could commit",
        "IMPORT_LEASE_LOST",
        409
      );
  }

  async function findMetadata(client, externalId, scope) {
    const seen = new Set();
    let cursor;
    while (true) {
      const page = await client.listMeetings({
        startTime: scope.startTime,
        endTime: scope.endTime,
        cursor,
      });
      const match = (page.items || []).find(
        (item) => String(item.externalId) === String(externalId)
      );
      if (match) return match;
      if (!page.nextCursor || seen.has(String(page.nextCursor))) break;
      seen.add(String(page.nextCursor));
      cursor = page.nextCursor;
    }
    throw new MeetingError(
      "Tencent Meeting did not return the selected meeting in this time range",
      "MEETING_NOT_FOUND",
      404
    );
  }

  async function queue(connectionId, externalId, scope = {}, userId, authContext = null) {
    const normalizedConnectionId = Number(connectionId);
    const normalizedExternalId =
      typeof externalId === "string" ? externalId.trim() : "";
    if (
      !Number.isSafeInteger(normalizedConnectionId) ||
      normalizedConnectionId <= 0 ||
      !normalizedExternalId
    ) {
      throw new MeetingError(
        "A valid connection and external meeting ID are required",
        "INVALID_IMPORT_ID"
      );
    }
    const selectedScope = { ...scope };
    if (selectedScope.from != null || selectedScope.to != null) {
      const from = Number(selectedScope.from ?? 0);
      const to = Number(selectedScope.to);
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from < 0 ||
        to <= from ||
        to - from > LIMITS.transcriptDurationMs
      ) {
        throw new MeetingError(
          "Transcript selection must be a positive interval of no more than three hours",
          "TRANSCRIPT_SCOPE_LIMIT"
        );
      }
      selectedScope.from = from;
      selectedScope.to = to;
    }
    if (!selectedScope.startTime || !selectedScope.endTime) {
      throw new MeetingError(
        "Meeting import requires a date range",
        "INVALID_IMPORT_SCOPE"
      );
    }
    const searchFrom = new Date(selectedScope.startTime);
    const searchTo = new Date(selectedScope.endTime);
    if (
      Number.isNaN(searchFrom.getTime()) ||
      Number.isNaN(searchTo.getTime()) ||
      searchTo <= searchFrom ||
      searchTo - searchFrom > 90 * 24 * 60 * 60 * 1000
    ) {
      throw new MeetingError(
        "Meeting discovery range must be a valid interval of at most 90 days",
        "INVALID_IMPORT_SCOPE"
      );
    }
    const connection = (await prisma.meeting_connections.findUnique)
      ? await prisma.meeting_connections.findUnique({
          where: { id: normalizedConnectionId },
        })
      : await prisma.meeting_connections.findFirst({
          where: { id: normalizedConnectionId },
        });
    if (!connection)
      throw new MeetingError(
        "Meeting connection not found",
        "MEETING_CONNECTION_NOT_FOUND",
        404
      );
    const config = await connectionConfig(connection);
    const client = clientFactory({ connection, config });
    const metadata = await findMetadata(
      client,
      normalizedExternalId,
      selectedScope
    );
    const startTime = new Date(metadata.startTime);
    const endTime = metadata.endTime ? new Date(metadata.endTime) : null;
    if (
      Number.isNaN(startTime.getTime()) ||
      (endTime && Number.isNaN(endTime.getTime()))
    ) {
      throw new MeetingError(
        "Tencent returned invalid meeting metadata",
        "TENCENT_INVALID_MEETING",
        502
      );
    }
    const quarter = quarterFor(startTime);
    const activeKey = makeActiveKey(
      normalizedConnectionId,
      normalizedExternalId
    );
    const payload = {
      scope: selectedScope,
      userId: userId ?? null,
      ...(authContext ? { authContext } : {}),
      meeting: {
        ...metadata,
        startTime: startTime.toISOString(),
        endTime: endTime?.toISOString() || null,
      },
    };
    const transaction = (callback) =>
      prisma.$transaction ? prisma.$transaction(callback) : callback(prisma);
    try {
      return await transaction(async (db) => {
        const duplicateMeeting = await db.meetings.findUnique({
          where: { activeKey },
        });
        if (duplicateMeeting)
          throw new MeetingError(
            "This meeting is already imported",
            "MEETING_DUPLICATE",
            409
          );
        const reservations = await db.meeting_jobs.findMany({
          where: {
            kind: "IMPORT",
            status: { in: ["CREATED", "PROCESSING"] },
            quarter,
          },
        });
        if (reservations.some((job) => job.activeKey === activeKey)) {
          throw new MeetingError(
            "This meeting already has an active import",
            "MEETING_DUPLICATE",
            409
          );
        }
        const meetings = await db.meetings.findMany({
          where: { quarter, deletedAt: null },
        });
        const activeMeetingKeys = new Set(
          meetings.map((meeting) => meeting.activeKey).filter(Boolean)
        );
        const reserved = reservations.filter(
          (job) => !job.activeKey || !activeMeetingKeys.has(job.activeKey)
        ).length;
        if (meetings.length + reserved >= LIMITS.meetingsPerQuarter) {
          throw new MeetingError(
            "The quarterly meeting limit has been reached",
            "MEETING_QUARTER_LIMIT",
            409
          );
        }
        const job = await db.meeting_jobs.create({
          data: {
            kind: "IMPORT",
            meetingId: null,
            connectionId: normalizedConnectionId,
            externalId: normalizedExternalId,
            activeKey,
            quarter,
            payload: JSON.stringify(payload),
            status: "CREATED",
            stage: "RESERVED",
            error: null,
            attempts: 0,
            leaseOwner: null,
            leaseUntil: null,
          },
        });
        await audit(
          {
            action: "MEETING_IMPORT_QUEUED",
            jobId: job.id,
            connectionId: normalizedConnectionId,
            externalId: normalizedExternalId,
            quarter,
            userId: userId ?? null,
          },
          db
        );
        return job;
      });
    } catch (error) {
      if (error.code === "P2002")
        throw new MeetingError(
          "This meeting already has an active import",
          "MEETING_DUPLICATE",
          409
        );
      throw error;
    }
  }

  async function process(jobInput) {
    const job =
      typeof jobInput === "number"
        ? await prisma.meeting_jobs.findUnique({ where: { id: jobInput } })
        : jobInput;
    if (!job || job.kind !== "IMPORT")
      throw new MeetingError(
        "Import job not found",
        "IMPORT_JOB_NOT_FOUND",
        404
      );
    const payload = parseJson(job.payload);
    const rollbackCleanups = [];
    try {
      await assertCurrentLease(prisma, job);
      await setStage(job, "FETCHING");
      const connection = await (prisma.meeting_connections.findUnique
        ? prisma.meeting_connections.findUnique({
            where: { id: job.connectionId },
          })
        : prisma.meeting_connections.findFirst({
            where: { id: job.connectionId },
          }));
      if (!connection)
        throw new MeetingError(
          "Meeting connection not found",
          "MEETING_CONNECTION_NOT_FOUND",
          404
        );
      const config = await connectionConfig(connection);
      const client = clientFactory({ connection, config });
      const metadata = payload.meeting;
      if (!metadata)
        throw new MeetingError(
          "Import job is missing reserved meeting metadata",
          "IMPORT_METADATA_MISSING",
          500
        );
      const contentScope = {
        ...(payload.scope || {}),
        meetingStartTime: metadata.startTime,
        meetingEndTime: metadata.endTime,
      };
      if (!contentScope.meetingEndTime)
        contentScope.meetingEndTime = payload.scope?.endTime;
      const content = clipContent(
        await client.getContent(job.externalId, contentScope),
        payload.scope || {}
      );

      const attachments = [];
      let attachmentBytes = 0;
      const selectedAttachmentIds = Array.isArray(payload.scope?.attachmentIds)
        ? new Set(payload.scope.attachmentIds.map(String))
        : null;
      for (const attachment of content.attachments || []) {
        if (
          selectedAttachmentIds &&
          !selectedAttachmentIds.has(String(attachment.externalFileId))
        )
          continue;
        if (!client.downloadAttachment) {
          if (!attachment.buffer)
            throw new MeetingError(
              "Tencent artifact download is required before import",
              "IMPORT_DOWNLOAD_UNAVAILABLE",
              502
            );
          attachments.push(attachment);
        } else {
          const buffer = await client.downloadAttachment(
            attachment.downloadUrl,
            LIMITS.fileBytes
          );
          if (buffer.byteLength > LIMITS.fileBytes)
            throw new MeetingError(
              "Tencent artifact exceeds the 100 MB file limit",
              "FILE_SIZE_LIMIT",
              413
            );
          attachments.push({ ...attachment, buffer, bytes: buffer.byteLength });
        }
        const bytes = Number(
          attachments[attachments.length - 1].bytes ??
            attachments[attachments.length - 1].buffer?.byteLength ??
            0
        );
        if (bytes > LIMITS.fileBytes)
          throw new MeetingError(
            "Tencent artifact exceeds the 100 MB file limit",
            "FILE_SIZE_LIMIT",
            413
          );
        attachmentBytes += bytes;
        if (attachments.length > LIMITS.filesPerMeeting)
          throw new MeetingError(
            "A meeting can have no more than 20 active files",
            "MEETING_FILE_COUNT_LIMIT",
            413
          );
        if (attachmentBytes > LIMITS.meetingBytes)
          throw new MeetingError(
            "A meeting can contain no more than 500 MB of files",
            "MEETING_SIZE_LIMIT",
            413
          );
      }
      if (selectedAttachmentIds) {
        const downloadedIds = new Set(
          attachments.map((attachment) => String(attachment.externalFileId))
        );
        const missingIds = [...selectedAttachmentIds].filter(
          (externalFileId) => !downloadedIds.has(externalFileId)
        );
        if (missingIds.length)
          throw new MeetingError(
            "One or more selected Tencent artifacts are no longer available",
            "IMPORT_SELECTED_ARTIFACT_MISSING",
            409
          );
      }
      const selectedContent = { ...content, attachments };
      const coverage = importCoverage(
        { ...selectedContent, attachments: content.attachments || [] },
        payload.scope || {}
      );
      const hasContent = hasSupportedContent(selectedContent);
      const availableCapabilities = Object.values(
        selectedContent.capabilities || {}
      ).some((capability) => capability?.status === "supported");
      const unknownCapabilities = [
        "transcript",
        "summary",
        "attachments",
      ].filter(
        (name) =>
          capabilitySnapshot(selectedContent.capabilities?.[name]).status ===
          "unknown"
      );
      if (!hasContent && unknownCapabilities.length) {
        throw new MeetingError(
          `Tencent capabilities must be verified before metadata-only import: ${unknownCapabilities.join(", ")}`,
          "TENCENT_CAPABILITY_UNVERIFIED",
          409
        );
      }
      if (!hasContent && availableCapabilities) {
        throw new MeetingError(
          "Tencent reported content capability but returned no usable content",
          "TENCENT_CONTENT_EMPTY",
          502
        );
      }
      if (!hasContent) {
        await setStage(job, "PUBLISHING");
        const transaction = (callback) =>
          prisma.$transaction
            ? prisma.$transaction(callback)
            : callback(prisma);
        const meeting = await transaction(async (tx) => {
          await assertCurrentLease(tx, job);
          const transactionalService = createMeetingService({
            prisma: tx,
            audit,
          });
          const created = await transactionalService.createMetadata(
            {
              connectionId: job.connectionId,
              externalId: job.externalId,
              title: metadata.title,
              startTime: metadata.startTime,
              endTime: metadata.endTime,
              coverage: JSON.stringify(coverage),
            },
            payload.userId
          );
          await completeJob(tx, job, {
            status: "SUCCESS",
            stage: "METADATA_ONLY",
            meetingId: created.id,
            activeKey: null,
            error: null,
            leaseOwner: null,
            leaseUntil: null,
          });
          await audit(
            {
              action: "MEETING_IMPORT_METADATA_ONLY",
              meetingId: created.id,
              userId: payload.userId ?? null,
            },
            tx
          );
          return created;
        });
        return meeting;
      }
      if (
        typeof sourceService.prepareImport !== "function" ||
        typeof sourceService.commitImport !== "function"
      ) {
        throw new MeetingError(
          "Meeting source importer is unavailable",
          "IMPORT_SOURCE_SERVICE_UNAVAILABLE",
          500
        );
      }
      await setStage(job, "PARSING_OCR");
      const prepared = await sourceService.prepareImport(selectedContent, {
        onStage: (stage) => setStage(job, stage),
      });
      if (!prepared || (Array.isArray(prepared) && prepared.length === 0)) {
        throw new MeetingError(
          "Tencent content did not produce any located source material",
          "IMPORT_CONTENT_UNUSABLE",
          422
        );
      }
      const transaction = (callback) =>
        prisma.$transaction ? prisma.$transaction(callback) : callback(prisma);
      await setStage(job, "PUBLISHING");
      const meeting = await transaction(async (tx) => {
        await assertCurrentLease(tx, job);
        const transactionalService = createMeetingService({
          prisma: tx,
          audit,
        });
        const created = await transactionalService.createMetadata(
          {
            connectionId: job.connectionId,
            externalId: job.externalId,
            title: metadata.title,
            startTime: metadata.startTime,
            endTime: metadata.endTime,
            summary: selectedContent.summary || null,
            transcript: selectedContent.transcript || null,
            coverage: JSON.stringify(coverage),
          },
          payload.userId
        );
        const indexing = await tx.meetings.update({
          where: { id: created.id },
          data: { retrievalStatus: "INDEXING", generation: 1 },
        });
        await sourceService.commitImport(tx, indexing, prepared, {
          onRollback: (cleanup) => rollbackCleanups.push(cleanup),
        });
        await completeJob(tx, job, {
          status: "SUCCESS",
          stage: "COMMITTED",
          meetingId: indexing.id,
          activeKey: null,
          error: null,
          leaseOwner: null,
          leaseUntil: null,
        });
        await audit(
          {
            action: "MEETING_IMPORT_COMMITTED",
            meetingId: indexing.id,
            userId: payload.userId ?? null,
          },
          tx
        );
        return indexing;
      });
      rollbackCleanups.length = 0;
      return meeting;
    } catch (error) {
      await Promise.allSettled(
        rollbackCleanups.map((cleanup) => Promise.resolve().then(cleanup))
      );
      await prisma.meeting_jobs.updateMany({
        where: {
          id: job.id,
          status: { in: ["CREATED", "PROCESSING"] },
          leaseOwner: job.leaseOwner ?? null,
        },
        data: {
          status: "FAILED",
          error: String(error?.message || "Import failed").slice(0, 1000),
          activeKey: null,
          leaseOwner: null,
          leaseUntil: null,
        },
      });
      throw error;
    }
  }

  return { queue, process };
}

module.exports = { createImporter, clipContent, hasSupportedContent };
