const crypto = require("crypto");
const fs = require("fs/promises");
const fsSync = require("fs");
const path = require("path");
const { MeetingError } = require("./errors");
const { LIMITS, RETRIEVAL } = require("./constants");
const { validateSegments } = require("./parser");

const MAX_SOURCE_BYTES = LIMITS.fileBytes;
const MAX_MEETING_BYTES = LIMITS.meetingBytes;
const MAX_FILES = LIMITS.filesPerMeeting;
const UPLOAD_EXTENSIONS = new Set([
  ".docx",
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".xlsx",
  ".pptx",
  ".md",
  ".txt",
]);

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const parseJson = (value, fallback) => {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const errorText = (error) =>
  String(error?.message || "Source processing failed").slice(0, 1000);
const asSegments = (value, transcript = false) =>
  String(value || "")
    .split(/\r?\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, paragraph) => ({
      text,
      location: transcript
        ? { type: "transcript", paragraph, startMs: 0, endMs: 0 }
        : { type: "paragraph", paragraph },
    }));

function meetingStorageDirectory(storageRoot, meeting) {
  if (
    !/^\d{4}-Q[1-4]$/.test(String(meeting?.quarter || "")) ||
    !Number.isSafeInteger(Number(meeting?.id)) ||
    Number(meeting.id) <= 0
  )
    throw new MeetingError(
      "Meeting archive identity is invalid",
      "INVALID_MEETING_ARCHIVE_ID",
      500
    );
  const directory = path.resolve(
    storageRoot,
    meeting.quarter,
    String(meeting.id)
  );
  const relative = path.relative(path.resolve(storageRoot), directory);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new MeetingError(
      "Meeting archive path escaped storage",
      "INVALID_MEETING_ARCHIVE_ID",
      500
    );
  return directory;
}

function createSourceService({
  prisma,
  parser,
  indexer,
  storageRoot = path.join(process.cwd(), "storage", "meetings"),
  trustedUploadRoot = null,
  audit = async () => {},
} = {}) {
  if (!prisma || !parser || !indexer)
    throw new TypeError(
      "createSourceService requires prisma, parser, and indexer"
    );

  const transaction = (callback) =>
    prisma.$transaction ? prisma.$transaction(callback) : callback(prisma);

  async function recordAudit(event, tx) {
    await audit(event, tx);
  }

  async function currentMeeting(db, meetingId) {
    const meeting = await db.meetings.findUnique({
      where: { id: Number(meetingId) },
    });
    if (
      !meeting ||
      meeting.deletedAt ||
      meeting.retrievalStatus === RETRIEVAL.DELETED
    ) {
      throw new MeetingError("Meeting not found", "MEETING_NOT_FOUND", 404);
    }
    return meeting;
  }

  async function cleanupTrustedTemp(inputPath) {
    if (!trustedUploadRoot || typeof inputPath !== "string") return;
    const root = path.resolve(trustedUploadRoot);
    const candidate = path.resolve(inputPath);
    const relative = path.relative(root, candidate);
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      return;
    await fs.rm(candidate, { force: true }).catch(() => {});
  }

  async function ensureSupplementAllowed(db, meetingId) {
    const meeting = await currentMeeting(db, meetingId);
    if (!["DRAFT", "APPROVED"].includes(meeting.reviewStatus))
      throw new MeetingError(
        "Meeting cannot accept sources in its current state",
        "MEETING_IMMUTABLE",
        409
      );
    return meeting;
  }

  async function checkLimits(db, meetingId, bytes, file) {
    if (!Number.isSafeInteger(bytes) || bytes <= 0)
      throw new MeetingError("Source content is empty", "SOURCE_EMPTY");
    if (file && bytes > MAX_SOURCE_BYTES)
      throw new MeetingError(
        "A source file cannot exceed 100 MB",
        "SOURCE_FILE_TOO_LARGE",
        413
      );
    const active = await db.meeting_sources.findMany({
      where: { meetingId, deletedAt: null },
    });
    const files = active.filter((source) =>
      ["TENCENT_ORIGINAL", "SUPPLEMENT_FILE"].includes(source.sourceType)
    );
    if (file && files.length >= MAX_FILES)
      throw new MeetingError(
        "A meeting cannot contain more than 20 active files",
        "SOURCE_FILE_LIMIT",
        409
      );
    const total = files.reduce(
      (sum, source) => sum + Number(source.bytes || 0),
      0
    );
    if (file && total + bytes > MAX_MEETING_BYTES)
      throw new MeetingError(
        "Meeting files cannot exceed 500 MB",
        "MEETING_SOURCE_LIMIT",
        413
      );
  }

  async function createParseJob(tx, meeting, source) {
    const generation = Number(meeting.generation || 0);
    const activeKey = `PARSE_SOURCE:${source.id}:${source.contentHash}:${generation}`;
    const existing = await tx.meeting_jobs.findFirst({
      where: { activeKey, status: { in: ["CREATED", "PROCESSING"] } },
    });
    if (existing) return existing;
    return tx.meeting_jobs.create({
      data: {
        kind: "PARSE_SOURCE",
        meetingId: meeting.id,
        connectionId: meeting.connectionId,
        externalId: meeting.externalId,
        quarter: meeting.quarter,
        activeKey,
        payload: JSON.stringify({
          sourceId: source.id,
          sourceRevision: source.contentHash,
          generation,
        }),
        status: "CREATED",
        stage: null,
        error: null,
        attempts: 0,
      },
    });
  }

  async function queueReindexForSourceSet(tx, meeting, sources) {
    const signature = hash(
      JSON.stringify(
        sources
          .map((source) => ({
            id: source.id,
            contentHash: source.contentHash ?? null,
            parseStatus: source.parseStatus,
            deletedAt: source.deletedAt ?? null,
          }))
          .sort((left, right) => left.id - right.id)
      )
    );
    const activeKey = `REINDEX:${meeting.id}:${meeting.generation}:SOURCES:${signature}`;
    const existing = await tx.meeting_jobs.findFirst({
      where: { activeKey, status: { in: ["CREATED", "PROCESSING"] } },
    });
    if (existing) return existing;
    return tx.meeting_jobs.create({
      data: {
        kind: "REINDEX",
        meetingId: meeting.id,
        connectionId: meeting.connectionId,
        externalId: meeting.externalId,
        quarter: meeting.quarter,
        activeKey,
        payload: JSON.stringify({
          generation: meeting.generation,
          sourceSetRevision: signature,
        }),
        status: "CREATED",
        attempts: 0,
      },
    });
  }

  async function persistSupplement({
    meetingId,
    name,
    sourceType,
    buffer,
    filePathInput,
    text,
    userId,
  }) {
    const initialMeeting = await ensureSupplementAllowed(prisma, meetingId);
    const raw = buffer || (text == null ? null : Buffer.from(text, "utf8"));
    let bytes = raw?.byteLength || 0;
    let contentHash;
    if (filePathInput) {
      if (!trustedUploadRoot)
        throw new MeetingError(
          "Trusted multipart upload storage is not configured",
          "SOURCE_INPUT_INVALID",
          500
        );
      const [realRoot, realInput] = await Promise.all([
        fs.realpath(trustedUploadRoot),
        fs.realpath(filePathInput),
      ]);
      const relative = path.relative(realRoot, realInput);
      if (
        relative === "" ||
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new MeetingError(
          "Temporary upload is outside the trusted upload directory",
          "SOURCE_INPUT_INVALID"
        );
      filePathInput = realInput;
      const stat = await fs.stat(filePathInput).catch(() => null);
      if (!stat?.isFile())
        throw new MeetingError(
          "Temporary upload is unavailable",
          "SOURCE_INPUT_INVALID"
        );
      bytes = stat.size;
      if (bytes > MAX_SOURCE_BYTES)
        throw new MeetingError(
          "A source file cannot exceed 100 MB",
          "SOURCE_FILE_TOO_LARGE",
          413
        );
      const digest = crypto.createHash("sha256");
      for await (const chunk of fsSync.createReadStream(filePathInput))
        digest.update(chunk);
      contentHash = digest.digest("hex");
    } else contentHash = hash(raw);
    if ((buffer || filePathInput) && bytes > MAX_SOURCE_BYTES)
      throw new MeetingError(
        "A source file cannot exceed 100 MB",
        "SOURCE_FILE_TOO_LARGE",
        413
      );
    let filePath = null;
    let savedFilePath = null;
    if (buffer || filePathInput) {
      const extension = path.extname(name).toLowerCase();
      if (!UPLOAD_EXTENSIONS.has(extension))
        throw new MeetingError(
          `Unsupported source format: ${extension || "unknown"}`,
          "SOURCE_FORMAT_UNSUPPORTED"
        );
      filePath = path.join(
        meetingStorageDirectory(storageRoot, initialMeeting),
        `${crypto.randomUUID()}${extension}`
      );
      savedFilePath = filePath;
      try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        if (buffer)
          await fs.writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
        else
          await fs.copyFile(
            filePathInput,
            filePath,
            fsSync.constants.COPYFILE_EXCL
          );
      } catch (error) {
        await fs.rm(filePath, { force: true }).catch(() => {});
        throw error;
      }
    }
    try {
      const source = await transaction(async (tx) => {
        const current = await ensureSupplementAllowed(tx, meetingId);
        await checkLimits(
          tx,
          current.id,
          bytes,
          Boolean(buffer || filePathInput)
        );
        const duplicate = await tx.meeting_sources.findFirst({
          where: { meetingId: current.id, activeHash: contentHash },
        });
        if (duplicate)
          throw new MeetingError(
            "Identical source content already exists in this meeting",
            "SOURCE_DUPLICATE",
            409
          );
        if (
          sourceType === "SUPPLEMENT_FILE" &&
          current.reviewStatus === "APPROVED"
        ) {
          const archivedFile = await tx.meeting_sources.findFirst({
            where: {
              meetingId: current.id,
              sourceType: "SUPPLEMENT_FILE",
              contentHash,
              deletedAt: { not: null },
            },
          });
          if (archivedFile)
            throw new MeetingError(
              "Reuploading a deleted supplemental file requires a draft meeting",
              "SOURCE_REUPLOAD_REQUIRES_DRAFT",
              409
            );
        }
        const initialSegments =
          text == null ? null : validateSegments(asSegments(text));
        const source = await tx.meeting_sources.create({
          data: {
            meetingId: current.id,
            sourceType,
            name: String(name || "source").slice(0, 255),
            contentHash,
            activeHash: contentHash,
            bytes,
            filePath,
            contentText: text == null ? null : String(text),
            segments: initialSegments ? JSON.stringify(initialSegments) : null,
            parseStatus: "PENDING",
            error: null,
            deletedAt: null,
            createdBy: userId ?? null,
          },
        });
        await createParseJob(tx, current, source);
        if (current.reviewStatus === "APPROVED")
          await tx.meetings.update({
            where: { id: current.id },
            data: { reviewStatus: "DRAFT", reviewedBy: null, reviewedAt: null },
          });
        await recordAudit(
          {
            action: "MEETING_SOURCE_ADDED",
            meetingId: source.meetingId,
            sourceId: source.id,
            sourceType: source.sourceType,
            userId: userId ?? null,
          },
          tx
        );
        return source;
      });
      return source;
    } catch (error) {
      if (savedFilePath)
        await fs.rm(savedFilePath, { force: true }).catch(() => {});
      if (filePathInput) await cleanupTrustedTemp(filePathInput);
      if (
        error.code === "P2002" ||
        (await prisma.meeting_sources.findFirst({
          where: { meetingId: Number(meetingId), activeHash: contentHash },
        }))
      ) {
        throw new MeetingError(
          "Identical source content already exists in this meeting",
          "SOURCE_DUPLICATE",
          409
        );
      }
      throw error;
    }
  }

  async function upload(meetingId, file, userId) {
    if (
      !file ||
      typeof file.name !== "string" ||
      (!Buffer.isBuffer(file.buffer) && typeof file.tempPath !== "string")
    )
      throw new MeetingError(
        "A named source file is required",
        "SOURCE_INPUT_INVALID"
      );
    try {
      return await persistSupplement({
        meetingId,
        name: file.name,
        sourceType: "SUPPLEMENT_FILE",
        buffer: file.buffer,
        filePathInput: file.tempPath,
        userId,
      });
    } catch (error) {
      if (file.tempPath) await cleanupTrustedTemp(file.tempPath);
      throw error;
    }
  }

  async function addText(meetingId, { name, text }, userId) {
    if (typeof text !== "string" || !text.trim())
      throw new MeetingError("Supplemental text is required", "SOURCE_EMPTY");
    return persistSupplement({
      meetingId,
      name: name || "Supplemental text",
      sourceType: "SUPPLEMENT_TEXT",
      text: text.trim(),
      userId,
    });
  }

  async function getSource(meetingId, sourceId) {
    const meeting = await currentMeeting(prisma, meetingId);
    const source = await prisma.meeting_sources.findFirst({
      where: { id: Number(sourceId), meetingId: meeting.id, deletedAt: null },
    });
    if (!source)
      throw new MeetingError(
        "Meeting source not found",
        "SOURCE_NOT_FOUND",
        404
      );
    return source;
  }

  async function getArchivedSource(meetingId, sourceId) {
    const source = await prisma.meeting_sources.findFirst({
      where: { id: Number(sourceId), meetingId: Number(meetingId) },
    });
    if (!source)
      throw new MeetingError(
        "Meeting source not found",
        "SOURCE_NOT_FOUND",
        404
      );
    const meeting = await prisma.meetings.findUnique({
      where: { id: Number(meetingId) },
    });
    return {
      ...source,
      deleted: Boolean(source.deletedAt),
      meetingDeleted: Boolean(
        meeting?.deletedAt || meeting?.retrievalStatus === RETRIEVAL.DELETED
      ),
      readOnly: true,
    };
  }

  async function remove(meetingId, sourceId, userId) {
    const result = await transaction(async (tx) => {
      const meeting = await currentMeeting(tx, meetingId);
      const source = await tx.meeting_sources.findFirst({
        where: { id: Number(sourceId), meetingId: meeting.id, deletedAt: null },
      });
      if (!source)
        throw new MeetingError(
          "Meeting source not found",
          "SOURCE_NOT_FOUND",
          404
        );
      if (
        !new Set(["SUPPLEMENT_FILE", "SUPPLEMENT_TEXT"]).has(source.sourceType)
      )
        throw new MeetingError(
          "Only draft supplemental sources can be deleted",
          "SOURCE_IMMUTABLE",
          409
        );
      if (
        source.sourceType === "SUPPLEMENT_FILE" &&
        meeting.reviewStatus !== "DRAFT"
      )
        throw new MeetingError(
          "Approved supplemental files are read-only",
          "SOURCE_IMMUTABLE",
          409
        );
      if (
        source.sourceType === "SUPPLEMENT_TEXT" &&
        !["DRAFT", "APPROVED"].includes(meeting.reviewStatus)
      )
        throw new MeetingError(
          "Meeting text cannot be deleted in its current state",
          "MEETING_IMMUTABLE",
          409
        );
      const deletedAt = new Date();
      await tx.meeting_sources.update({
        where: { id: source.id },
        data: { deletedAt, activeHash: null },
      });
      const generation = Number(meeting.generation || 0) + 1;
      const updated = await tx.meetings.update({
        where: { id: meeting.id },
        data: {
          generation,
          retrievalStatus: RETRIEVAL.INDEXING,
          ...(source.sourceType === "SUPPLEMENT_TEXT" &&
          meeting.reviewStatus === "APPROVED"
            ? { reviewStatus: "DRAFT", reviewedBy: null, reviewedAt: null }
            : {}),
        },
      });
      await tx.meeting_jobs.create({
        data: {
          kind: "REINDEX",
          meetingId: meeting.id,
          connectionId: meeting.connectionId,
          externalId: meeting.externalId,
          quarter: meeting.quarter,
          activeKey: `REINDEX:${meeting.id}:${generation}`,
          payload: JSON.stringify({ generation }),
          status: "CREATED",
          attempts: 0,
        },
      });
      const output = {
        source: { ...source, deletedAt, activeHash: null },
        meeting: updated,
        generation,
      };
      await recordAudit(
        {
          action: "MEETING_SOURCE_DELETED",
          meetingId: updated.id,
          sourceId: source.id,
          userId: userId ?? null,
          generation,
        },
        tx
      );
      return output;
    });
    return result.source;
  }

  async function retry(sourceId, userId) {
    return transaction(async (tx) => {
      const source = await tx.meeting_sources.findUnique({
        where: { id: Number(sourceId) },
      });
      if (!source || source.deletedAt || source.parseStatus !== "FAILED")
        throw new MeetingError(
          "Only active failed sources can be retried",
          "SOURCE_NOT_RETRYABLE",
          409
        );
      const meeting = await currentMeeting(tx, source.meetingId);
      const pending = await tx.meeting_sources.update({
        where: { id: source.id },
        data: { parseStatus: "PENDING", error: null },
      });
      await createParseJob(tx, meeting, pending);
      await recordAudit(
        {
          action: "MEETING_SOURCE_RETRY_QUEUED",
          meetingId: meeting.id,
          sourceId: source.id,
          userId: userId ?? null,
        },
        tx
      );
      return pending;
    });
  }

  async function leaseIsCurrent(db, job) {
    if (!job?.leaseOwner) return true;
    const current = await db.meeting_jobs.findUnique({
      where: { id: Number(job.id) },
    });
    return Boolean(
      current &&
      current.status === "PROCESSING" &&
      current.leaseOwner === job.leaseOwner &&
      current.leaseUntil &&
      new Date(current.leaseUntil).getTime() > Date.now()
    );
  }

  async function requeuePendingSourceInTransaction(
    tx,
    job,
    source,
    meeting,
    attemptedGeneration
  ) {
    if (
      !source ||
      source.deletedAt ||
      source.parseStatus !== "PENDING" ||
      !meeting ||
      meeting.deletedAt ||
      meeting.retrievalStatus === RETRIEVAL.DELETED ||
      Number(meeting.generation) === Number(attemptedGeneration) ||
      source.contentHash !== parseJson(job.payload, {}).sourceRevision
    )
      return { stale: true };
    await createParseJob(tx, meeting, source);
    return { stale: true, requeued: true };
  }

  async function requeuePendingSource(job, source, meeting) {
    return transaction(async (tx) => {
      const currentSource = await tx.meeting_sources.findUnique({
        where: { id: source.id },
      });
      const currentMeeting = await tx.meetings.findUnique({
        where: { id: meeting.id },
      });
      return requeuePendingSourceInTransaction(
        tx,
        job,
        currentSource,
        currentMeeting,
        parseJson(job.payload, {}).generation ?? meeting.generation
      );
    });
  }

  async function processParseSource(job) {
    const payload = parseJson(job.payload, {});
    const sourceId = Number(payload.sourceId);
    const source = await prisma.meeting_sources.findUnique({
      where: { id: sourceId },
    });
    const meeting =
      source &&
      (await prisma.meetings.findUnique({ where: { id: source.meetingId } }));
    if (
      !source ||
      source.deletedAt ||
      !meeting ||
      meeting.deletedAt ||
      meeting.retrievalStatus === RETRIEVAL.DELETED ||
      source.contentHash !== payload.sourceRevision
    )
      return { stale: true };
    const attemptedGeneration = Number(
      payload.generation ?? meeting.generation
    );
    if (attemptedGeneration !== Number(meeting.generation))
      return requeuePendingSource(job, source, meeting);
    if (!(await leaseIsCurrent(prisma, job))) return { stale: true };
    try {
      const segments =
        source.sourceType === "SUPPLEMENT_TEXT"
          ? validateSegments(
              parseJson(source.segments, asSegments(source.contentText))
            )
          : validateSegments(
              await parser.parse({
                name: source.name,
                buffer: await fs.readFile(source.filePath),
              })
            );
      const chunks = await indexer.prepare(segments);
      if (!chunks.length)
        throw new MeetingError(
          "Source produced no indexable chunks",
          "INDEX_CONTENT_EMPTY"
        );
      const result = await transaction(async (tx) => {
        const currentSource = await tx.meeting_sources.findUnique({
          where: { id: sourceId },
        });
        const currentMeeting = await tx.meetings.findUnique({
          where: { id: source.meetingId },
        });
        if (!(await leaseIsCurrent(tx, job))) return { stale: true };
        if (
          !currentSource ||
          currentSource.deletedAt ||
          currentSource.contentHash !== payload.sourceRevision ||
          !currentMeeting ||
          currentMeeting.generation !== attemptedGeneration ||
          currentMeeting.deletedAt ||
          currentMeeting.retrievalStatus === RETRIEVAL.DELETED
        )
          return requeuePendingSourceInTransaction(
            tx,
            job,
            currentSource,
            currentMeeting,
            attemptedGeneration
          );
        await tx.meeting_chunks.deleteMany({ where: { sourceId } });
        for (const chunk of chunks)
          await tx.meeting_chunks.create({
            data: {
              meetingId: currentMeeting.id,
              sourceId,
              text: chunk.text,
              location: JSON.stringify(chunk.location),
              embedding: JSON.stringify({
                profileId: indexer.profileId || "default",
                vector: chunk.embedding,
              }),
              generation: currentMeeting.generation,
            },
          });
        await tx.meeting_sources.update({
          where: { id: sourceId },
          data: {
            parseStatus: "SUCCESS",
            segments: JSON.stringify(segments),
            error: null,
          },
        });
        const activeSuccess = await tx.meeting_sources.findMany({
          where: {
            meetingId: currentMeeting.id,
            deletedAt: null,
            parseStatus: "SUCCESS",
          },
        });
        const activeSuccessIds = new Set(
          activeSuccess.map((activeSource) => activeSource.id)
        );
        const activeChunks = await tx.meeting_chunks.findMany({
          where: {
            meetingId: currentMeeting.id,
            generation: currentMeeting.generation,
          },
        });
        indexer.validateIndex([
          ...activeChunks.filter(
            (chunk) =>
              chunk.sourceId !== sourceId &&
              activeSuccessIds.has(chunk.sourceId)
          ),
          ...chunks.map((chunk) => ({
            embedding: {
              profileId: indexer.profileId || "default",
              vector: chunk.embedding,
            },
          })),
        ]);
        const chunkedSourceIds = new Set(
          activeChunks.map((chunk) => chunk.sourceId)
        );
        const hasCompleteCurrentIndex =
          activeSuccess.length > 0 &&
          activeSuccess.every((activeSource) =>
            chunkedSourceIds.has(activeSource.id)
          );
        if (
          hasCompleteCurrentIndex &&
          [
            RETRIEVAL.WAITING_CONTENT,
            RETRIEVAL.INDEX_FAILED,
            RETRIEVAL.INDEXING,
          ].includes(currentMeeting.retrievalStatus)
        )
          await tx.meetings.update({
            where: { id: currentMeeting.id },
            data: { retrievalStatus: RETRIEVAL.AVAILABLE },
          });
        else if (
          activeSuccess.length > 0 &&
          currentMeeting.retrievalStatus !== RETRIEVAL.AVAILABLE
        ) {
          const activeSources = await tx.meeting_sources.findMany({
            where: { meetingId: currentMeeting.id, deletedAt: null },
          });
          await queueReindexForSourceSet(tx, currentMeeting, activeSources);
        }
        await recordAudit(
          {
            action: "MEETING_SOURCE_INDEXED",
            meetingId: currentMeeting.id,
            sourceId,
            chunkCount: chunks.length,
          },
          tx
        );
        return { stale: false, sourceId, chunkCount: chunks.length };
      });
      return result;
    } catch (error) {
      const failureResult = await transaction(async (tx) => {
        const currentSource = await tx.meeting_sources.findUnique({
          where: { id: sourceId },
        });
        const currentMeeting =
          currentSource &&
          (await tx.meetings.findUnique({
            where: { id: currentSource.meetingId },
          }));
        if (!(await leaseIsCurrent(tx, job))) return { stale: true };
        if (
          !currentSource ||
          currentSource.deletedAt ||
          currentSource.contentHash !== payload.sourceRevision ||
          !currentMeeting ||
          currentMeeting.generation !== attemptedGeneration ||
          currentMeeting.deletedAt
        ) {
          const requeued = await requeuePendingSourceInTransaction(
            tx,
            job,
            currentSource,
            currentMeeting,
            attemptedGeneration
          );
          return requeued;
        }
        if (currentSource.parseStatus === "SUCCESS") return { stale: true };
        await tx.meeting_sources.update({
          where: { id: sourceId },
          data: { parseStatus: "FAILED", error: errorText(error) },
        });
        if (currentMeeting.retrievalStatus !== RETRIEVAL.AVAILABLE) {
          const activeSuccess = await tx.meeting_sources.findMany({
            where: {
              meetingId: currentMeeting.id,
              deletedAt: null,
              parseStatus: "SUCCESS",
            },
          });
          const currentChunks = await tx.meeting_chunks.findMany({
            where: {
              meetingId: currentMeeting.id,
              generation: currentMeeting.generation,
            },
          });
          const chunkedSources = new Set(
            currentChunks.map((chunk) => chunk.sourceId)
          );
          const complete =
            activeSuccess.length > 0 &&
            activeSuccess.every((activeSource) =>
              chunkedSources.has(activeSource.id)
            );
          if (!complete && activeSuccess.length > 0) {
            const activeSources = await tx.meeting_sources.findMany({
              where: { meetingId: currentMeeting.id, deletedAt: null },
            });
            await queueReindexForSourceSet(tx, currentMeeting, activeSources);
          }
          await tx.meetings.update({
            where: { id: currentMeeting.id },
            data: {
              retrievalStatus: complete
                ? RETRIEVAL.AVAILABLE
                : activeSuccess.length > 0
                  ? RETRIEVAL.INDEXING
                  : RETRIEVAL.INDEX_FAILED,
            },
          });
        }
        await recordAudit(
          {
            action: "MEETING_SOURCE_FAILED",
            meetingId: currentMeeting.id,
            sourceId,
            code: error?.code || "SOURCE_PROCESSING_FAILED",
          },
          tx
        );
        return { recorded: true };
      });
      if (!failureResult.recorded) return failureResult;
      throw error;
    }
  }

  async function process(job) {
    if (job.kind === "PARSE_SOURCE") return processParseSource(job);
    if (job.kind !== "REINDEX")
      throw new MeetingError(
        `Unsupported source job kind: ${job.kind}`,
        "SOURCE_JOB_UNSUPPORTED"
      );
    const payload = parseJson(job.payload, {});
    const queuedMeeting = await prisma.meetings.findUnique({
      where: { id: Number(job.meetingId) },
    });
    if (
      !queuedMeeting ||
      queuedMeeting.deletedAt ||
      queuedMeeting.retrievalStatus === RETRIEVAL.DELETED ||
      queuedMeeting.generation !== Number(payload.generation)
    )
      return { stale: true, count: 0 };
    try {
      const result = await indexer.reindex(job.meetingId, { job });
      if (result.stale) return result;
      if (
        result.generation !== undefined &&
        result.generation !== Number(payload.generation)
      )
        return { stale: true };
      return result;
    } catch (error) {
      await transaction(async (tx) => {
        if (!(await leaseIsCurrent(tx, job))) return;
        const meeting = await tx.meetings.findUnique({
          where: { id: Number(job.meetingId) },
        });
        if (
          meeting &&
          !meeting.deletedAt &&
          meeting.retrievalStatus !== RETRIEVAL.DELETED &&
          meeting.generation === Number(payload.generation)
        ) {
          await tx.meetings.update({
            where: { id: meeting.id },
            data: { retrievalStatus: RETRIEVAL.INDEX_FAILED },
          });
        }
      });
      throw error;
    }
  }

  async function prepareImport(content) {
    const prepared = [];
    const add = async (sourceType, name, segments, metadata = {}) => {
      const located = validateSegments(segments);
      const chunks = await indexer.prepare(located);
      if (!chunks.length)
        throw new MeetingError(
          "Imported source produced no indexable chunks",
          "IMPORT_CONTENT_UNUSABLE",
          422
        );
      const contentText = located.map((segment) => segment.text).join("\n");
      prepared.push({
        profileId: indexer.profileId || "default",
        sourceType,
        name,
        segments: located,
        chunks,
        contentText,
        contentHash: hash(metadata.buffer || Buffer.from(contentText)),
        ...metadata,
      });
    };
    if (
      Array.isArray(content.summarySegments) &&
      content.summarySegments.length
    ) {
      await add("SUMMARY", "Tencent meeting summary", content.summarySegments, {
        ...(typeof content.summary === "string"
          ? { contentText: content.summary }
          : {}),
        provenance: {
          recordFileIds: [
            ...new Set(
              content.summarySegments
                .map((segment) => segment.location?.recordFileId)
                .filter(Boolean)
            ),
          ],
        },
      });
    } else if (typeof content.summary === "string" && content.summary.trim()) {
      await add(
        "SUMMARY",
        "Tencent meeting summary",
        asSegments(content.summary),
        { contentText: content.summary }
      );
    }
    if (Array.isArray(content.segments) && content.segments.length) {
      await add(
        "TRANSCRIPT",
        "Tencent meeting transcript",
        content.segments,
        typeof content.transcript === "string"
          ? { contentText: content.transcript }
          : {}
      );
    } else if (
      typeof content.transcript === "string" &&
      content.transcript.trim()
    ) {
      await add(
        "TRANSCRIPT",
        "Tencent meeting transcript",
        asSegments(content.transcript, true),
        { contentText: content.transcript }
      );
    }
    for (const attachment of content.attachments || []) {
      if (!Buffer.isBuffer(attachment.buffer))
        throw new MeetingError(
          "Tencent attachment has no downloaded content",
          "IMPORT_ATTACHMENT_INVALID",
          422
        );
      const segments = await parser.parse({
        name: attachment.name,
        buffer: attachment.buffer,
      });
      await add("TENCENT_ORIGINAL", attachment.name, segments, {
        buffer: attachment.buffer,
        bytes: attachment.bytes ?? attachment.buffer.byteLength,
        externalFileId: attachment.externalFileId ?? null,
        artifactType: attachment.artifactType ?? null,
        provenance: {
          externalFileId: attachment.externalFileId ?? null,
          artifactType: attachment.artifactType ?? null,
        },
      });
    }
    if (!prepared.length || !prepared.some((source) => source.chunks.length))
      throw new MeetingError(
        "Tencent content did not produce any located source material",
        "IMPORT_CONTENT_UNUSABLE",
        422
      );
    return prepared;
  }

  async function commitImport(tx, meeting, prepared, { onRollback } = {}) {
    if (!Array.isArray(prepared) || !prepared.length)
      throw new MeetingError(
        "No prepared import sources were supplied",
        "IMPORT_CONTENT_UNUSABLE",
        422
      );
    let totalChunks = 0;
    const filePaths = [];
    try {
      indexer.validateIndex(
        prepared.flatMap((item) => {
          if (item.profileId !== (indexer.profileId || "default"))
            throw new MeetingError(
              "Prepared import vectors do not match the configured embedding profile",
              "EMBEDDING_PROFILE_MISMATCH",
              503
            );
          return (item.chunks || []).map((chunk) => ({
            embedding: {
              profileId: item.profileId,
              vector: chunk.embedding,
            },
          }));
        })
      );
      for (const item of prepared) {
        if (
          !Array.isArray(item.segments) ||
          !item.segments.length ||
          !Array.isArray(item.chunks) ||
          !item.chunks.length
        ) {
          throw new MeetingError(
            "Prepared import contains an empty or unusable source",
            "IMPORT_CONTENT_UNUSABLE",
            422
          );
        }
        let filePath = null;
        if (item.buffer) {
          const extension = path.extname(item.name).toLowerCase();
          filePath = path.join(
            meetingStorageDirectory(storageRoot, meeting),
            `${crypto.randomUUID()}${extension}`
          );
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, item.buffer, {
            flag: "wx",
            mode: 0o600,
          });
          filePaths.push(filePath);
          if (typeof onRollback === "function" && filePaths.length === 1)
            onRollback(async () => {
              await Promise.all(
                filePaths.map((storedPath) =>
                  fs.rm(storedPath, { force: true }).catch(() => {})
                )
              );
            });
        }
        const source = await tx.meeting_sources.create({
          data: {
            meetingId: meeting.id,
            sourceType: item.sourceType,
            name: String(item.name).slice(0, 255),
            contentHash:
              item.contentHash || hash(Buffer.from(item.contentText || "")),
            activeHash:
              item.sourceType === "TENCENT_ORIGINAL" && item.externalFileId
                ? `tencent:${item.externalFileId}`
                : `${item.sourceType}:${item.contentHash || hash(Buffer.from(item.contentText || ""))}`,
            bytes: Number(item.bytes || item.buffer?.byteLength || 0),
            filePath,
            contentText: item.contentText || null,
            segments: JSON.stringify(
              item.provenance
                ? { segments: item.segments, provenance: item.provenance }
                : item.segments
            ),
            parseStatus: "SUCCESS",
            error: null,
            deletedAt: null,
          },
        });
        for (const chunk of item.chunks) {
          await tx.meeting_chunks.create({
            data: {
              meetingId: meeting.id,
              sourceId: source.id,
              text: chunk.text,
              location: JSON.stringify(chunk.location),
              embedding: JSON.stringify({
                profileId: indexer.profileId || "default",
                vector: chunk.embedding,
              }),
              generation: meeting.generation,
            },
          });
          totalChunks += 1;
        }
      }
      if (!totalChunks)
        throw new MeetingError(
          "Imported sources produced no indexable chunks",
          "IMPORT_CONTENT_UNUSABLE",
          422
        );
      await tx.meetings.update({
        where: { id: meeting.id },
        data: { retrievalStatus: RETRIEVAL.AVAILABLE },
      });
      return { sourceCount: prepared.length, chunkCount: totalChunks };
    } catch (error) {
      for (const filePath of filePaths)
        await fs.rm(filePath, { force: true }).catch(() => {});
      throw error;
    }
  }

  return {
    upload,
    addText,
    remove,
    retry,
    process,
    prepareImport,
    commitImport,
    getSource,
    getArchivedSource,
  };
}

module.exports = { createSourceService };
