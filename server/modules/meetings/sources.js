const crypto = require("crypto");
const fs = require("fs/promises");
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

function createSourceService({
  prisma,
  parser,
  indexer,
  storageRoot = path.join(process.cwd(), "storage", "meetings"),
  audit = async () => {},
} = {}) {
  if (!prisma || !parser || !indexer)
    throw new TypeError(
      "createSourceService requires prisma, parser, and indexer"
    );

  const transaction = (callback) =>
    prisma.$transaction ? prisma.$transaction(callback) : callback(prisma);

  async function recordAudit(event) {
    await Promise.resolve()
      .then(() => audit(event))
      .catch(() => {});
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
    const files = active.filter(
      (source) => source.bytes > 0 && source.sourceType !== "SUPPLEMENT_TEXT"
    );
    if (file && files.length >= MAX_FILES)
      throw new MeetingError(
        "A meeting cannot contain more than 20 active files",
        "SOURCE_FILE_LIMIT",
        409
      );
    const total = active.reduce(
      (sum, source) => sum + Number(source.bytes || 0),
      0
    );
    if (total + bytes > MAX_MEETING_BYTES)
      throw new MeetingError(
        "Meeting sources cannot exceed 500 MB",
        "MEETING_SOURCE_LIMIT",
        413
      );
  }

  async function createParseJob(tx, meeting, source) {
    return tx.meeting_jobs.create({
      data: {
        kind: "PARSE_SOURCE",
        meetingId: meeting.id,
        connectionId: meeting.connectionId,
        externalId: meeting.externalId,
        quarter: meeting.quarter,
        activeKey: `PARSE_SOURCE:${source.id}:${source.contentHash}`,
        payload: JSON.stringify({
          sourceId: source.id,
          sourceRevision: source.contentHash,
        }),
        status: "CREATED",
        stage: null,
        error: null,
        attempts: 0,
      },
    });
  }

  async function persistSupplement({
    meetingId,
    name,
    sourceType,
    buffer,
    text,
    userId,
  }) {
    await ensureSupplementAllowed(prisma, meetingId);
    const raw = buffer || Buffer.from(text, "utf8");
    const bytes = raw.byteLength;
    const contentHash = hash(raw);
    if (buffer && bytes > MAX_SOURCE_BYTES)
      throw new MeetingError(
        "A source file cannot exceed 100 MB",
        "SOURCE_FILE_TOO_LARGE",
        413
      );
    let filePath = null;
    let savedFilePath = null;
    if (buffer) {
      const extension = path.extname(name).toLowerCase();
      if (!UPLOAD_EXTENSIONS.has(extension))
        throw new MeetingError(
          `Unsupported source format: ${extension || "unknown"}`,
          "SOURCE_FORMAT_UNSUPPORTED"
        );
      filePath = path.join(storageRoot, `${crypto.randomUUID()}${extension}`);
      savedFilePath = filePath;
      await fs.mkdir(storageRoot, { recursive: true });
      await fs.writeFile(filePath, buffer, { flag: "wx", mode: 0o600 });
    }
    try {
      const source = await transaction(async (tx) => {
        const current = await ensureSupplementAllowed(tx, meetingId);
        await checkLimits(tx, current.id, bytes, Boolean(buffer));
        const duplicate = await tx.meeting_sources.findFirst({
          where: { meetingId: current.id, activeHash: contentHash },
        });
        if (duplicate)
          throw new MeetingError(
            "Identical source content already exists in this meeting",
            "SOURCE_DUPLICATE",
            409
          );
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
        return source;
      });
      await recordAudit({
        action: "MEETING_SOURCE_ADDED",
        meetingId: source.meetingId,
        sourceId: source.id,
        sourceType: source.sourceType,
        userId: userId ?? null,
      });
      return source;
    } catch (error) {
      if (savedFilePath)
        await fs.rm(savedFilePath, { force: true }).catch(() => {});
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
    if (!file || typeof file.name !== "string" || !Buffer.isBuffer(file.buffer))
      throw new MeetingError(
        "A named source file is required",
        "SOURCE_INPUT_INVALID"
      );
    return persistSupplement({
      meetingId,
      name: file.name,
      sourceType: "SUPPLEMENT_FILE",
      buffer: file.buffer,
      userId,
    });
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
      where: { id: Number(sourceId), meetingId: meeting.id },
    });
    if (!source)
      throw new MeetingError(
        "Meeting source not found",
        "SOURCE_NOT_FOUND",
        404
      );
    return source;
  }

  async function remove(meetingId, sourceId, userId) {
    let removedPath = null;
    const result = await transaction(async (tx) => {
      const meeting = await currentMeeting(tx, meetingId);
      if (meeting.reviewStatus !== "DRAFT")
        throw new MeetingError(
          "Only draft meeting sources can be deleted",
          "MEETING_IMMUTABLE",
          409
        );
      const source = await tx.meeting_sources.findFirst({
        where: { id: Number(sourceId), meetingId: meeting.id, deletedAt: null },
      });
      if (!source)
        throw new MeetingError(
          "Meeting source not found",
          "SOURCE_NOT_FOUND",
          404
        );
      if (source.sourceType === "TENCENT_ORIGINAL")
        throw new MeetingError(
          "Tencent original sources are read-only",
          "SOURCE_IMMUTABLE",
          409
        );
      removedPath = source.filePath;
      const deletedAt = new Date();
      await tx.meeting_sources.update({
        where: { id: source.id },
        data: { deletedAt, activeHash: null },
      });
      const generation = Number(meeting.generation || 0) + 1;
      const updated = await tx.meetings.update({
        where: { id: meeting.id },
        data: { generation, retrievalStatus: RETRIEVAL.INDEXING },
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
      return {
        source: { ...source, deletedAt, activeHash: null },
        meeting: updated,
        generation,
      };
    });
    if (removedPath) await fs.rm(removedPath, { force: true }).catch(() => {});
    await recordAudit({
      action: "MEETING_SOURCE_DELETED",
      meetingId: result.meeting.id,
      sourceId: result.source.id,
      userId: userId ?? null,
      generation: result.generation,
    });
    return result.source;
  }

  async function retry(sourceId) {
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
      return pending;
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
        if (
          !currentSource ||
          currentSource.deletedAt ||
          currentSource.contentHash !== payload.sourceRevision ||
          !currentMeeting ||
          currentMeeting.generation !== meeting.generation ||
          currentMeeting.deletedAt ||
          currentMeeting.retrievalStatus === RETRIEVAL.DELETED
        )
          return { stale: true };
        await tx.meeting_chunks.deleteMany({ where: { sourceId } });
        for (const chunk of chunks)
          await tx.meeting_chunks.create({
            data: {
              meetingId: currentMeeting.id,
              sourceId,
              text: chunk.text,
              location: JSON.stringify(chunk.location),
              embedding: JSON.stringify(chunk.embedding),
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
        const activeChunks = await tx.meeting_chunks.findMany({
          where: {
            meetingId: currentMeeting.id,
            generation: currentMeeting.generation,
          },
        });
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
          [RETRIEVAL.WAITING_CONTENT, RETRIEVAL.INDEX_FAILED].includes(
            currentMeeting.retrievalStatus
          )
        )
          await tx.meetings.update({
            where: { id: currentMeeting.id },
            data: { retrievalStatus: RETRIEVAL.AVAILABLE },
          });
        return { stale: false, sourceId, chunkCount: chunks.length };
      });
      if (!result.stale)
        await recordAudit({
          action: "MEETING_SOURCE_INDEXED",
          meetingId: meeting.id,
          sourceId,
          chunkCount: chunks.length,
        });
      return result;
    } catch (error) {
      const recorded = await transaction(async (tx) => {
        const currentSource = await tx.meeting_sources.findUnique({
          where: { id: sourceId },
        });
        const currentMeeting =
          currentSource &&
          (await tx.meetings.findUnique({
            where: { id: currentSource.meetingId },
          }));
        if (
          !currentSource ||
          currentSource.deletedAt ||
          currentSource.contentHash !== payload.sourceRevision ||
          !currentMeeting ||
          currentMeeting.generation !== meeting.generation ||
          currentMeeting.deletedAt
        )
          return false;
        await tx.meeting_sources.update({
          where: { id: sourceId },
          data: { parseStatus: "FAILED", error: errorText(error) },
        });
        if (
          currentMeeting.retrievalStatus !== RETRIEVAL.AVAILABLE &&
          currentMeeting.retrievalStatus !== RETRIEVAL.INDEXING
        ) {
          await tx.meetings.update({
            where: { id: currentMeeting.id },
            data: { retrievalStatus: RETRIEVAL.INDEX_FAILED },
          });
        }
        return true;
      });
      if (recorded)
        await recordAudit({
          action: "MEETING_SOURCE_FAILED",
          meetingId: meeting.id,
          sourceId,
          error: errorText(error),
        });
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
      const result = await indexer.reindex(job.meetingId);
      if (result.stale) return result;
      if (
        result.generation !== undefined &&
        result.generation !== Number(payload.generation)
      )
        return { stale: true };
      return result;
    } catch (error) {
      await transaction(async (tx) => {
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

  async function commitImport(tx, meeting, prepared) {
    if (!Array.isArray(prepared) || !prepared.length)
      throw new MeetingError(
        "No prepared import sources were supplied",
        "IMPORT_CONTENT_UNUSABLE",
        422
      );
    let totalChunks = 0;
    const filePaths = [];
    try {
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
            storageRoot,
            `${crypto.randomUUID()}${extension}`
          );
          await fs.mkdir(storageRoot, { recursive: true });
          await fs.writeFile(filePath, item.buffer, {
            flag: "wx",
            mode: 0o600,
          });
          filePaths.push(filePath);
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
              embedding: JSON.stringify(chunk.embedding),
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
  };
}

module.exports = { createSourceService };
