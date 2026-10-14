const crypto = require("crypto");
const { MeetingError } = require("./errors");
const { RETRIEVAL } = require("./constants");

const DEFAULT_CHUNK_CHARACTERS = 1200;
const hashText = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

function splitText(text, maxCharacters) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxCharacters) {
      if (current) chunks.push(current);
      current = "";
      for (let index = 0; index < word.length; index += maxCharacters)
        chunks.push(word.slice(index, index + maxCharacters));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxCharacters && current) {
      chunks.push(current);
      current = word;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseJson(value, fallback) {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function cosine(left, right) {
  if (
    !Array.isArray(left) ||
    !Array.isArray(right) ||
    left.length !== right.length ||
    !left.length
  )
    return -1;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]);
    const b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : -1;
}

function createIndexer({
  prisma,
  embedder,
  chunkCharacters = DEFAULT_CHUNK_CHARACTERS,
} = {}) {
  if (!prisma)
    throw new TypeError("createIndexer requires an injected Prisma client");

  async function vectorize(texts, operation) {
    if (typeof embedder?.[operation] !== "function") {
      throw new MeetingError(
        `Embedding operation ${operation} is not configured`,
        "EMBEDDER_UNCONFIGURED",
        503
      );
    }
    try {
      const result =
        operation === "embedQuery"
          ? [await embedder[operation](texts[0])]
          : await embedder[operation](texts);
      const vectors = result;
      if (
        !Array.isArray(vectors) ||
        vectors.length !== texts.length ||
        vectors.some(
          (vector) =>
            !Array.isArray(vector) ||
            !vector.length ||
            vector.some((value) => !Number.isFinite(Number(value)))
        )
      ) {
        throw new Error("Embedding service returned an invalid vector set");
      }
      return vectors.map((vector) => vector.map(Number));
    } catch (error) {
      if (error instanceof MeetingError) throw error;
      throw new MeetingError(
        `Embedding failed: ${error.message}`,
        "EMBEDDING_FAILED",
        502
      );
    }
  }

  async function prepare(segments) {
    if (!Array.isArray(segments) || !segments.length)
      throw new MeetingError(
        "No located source segments are available to index",
        "INDEX_CONTENT_EMPTY"
      );
    const pieces = [];
    for (const segment of segments) {
      const text = typeof segment?.text === "string" ? segment.text.trim() : "";
      if (!text || !segment.location || typeof segment.location !== "object")
        continue;
      for (const part of splitText(text, chunkCharacters))
        pieces.push({
          text: part,
          location: segment.location,
          ...(segment.sourceId != null ? { sourceId: segment.sourceId } : {}),
        });
    }
    if (!pieces.length)
      throw new MeetingError(
        "No nonempty located content is available to index",
        "INDEX_CONTENT_EMPTY"
      );
    const vectors = await vectorize(
      pieces.map((piece) => piece.text),
      "embedDocuments"
    );
    return pieces.map((piece, index) => ({
      ...piece,
      embedding: vectors[index],
    }));
  }

  async function search(meetingIds, question, limit = 20) {
    const ids = [
      ...new Set(
        (meetingIds || [])
          .map(Number)
          .filter((id) => Number.isSafeInteger(id) && id > 0)
      ),
    ];
    if (!ids.length || typeof question !== "string" || !question.trim())
      return [];
    const safeLimit = Math.max(
      1,
      Math.min(100, Math.floor(Number(limit) || 20))
    );
    const [queryVector] = await vectorize([question], "embedQuery");
    const meetings = await prisma.meetings.findMany({
      where: {
        id: { in: ids },
        deletedAt: null,
        retrievalStatus: RETRIEVAL.AVAILABLE,
      },
    });
    if (!meetings.length) return [];
    const sourceRows = await prisma.meeting_sources.findMany({
      where: {
        meetingId: { in: meetings.map((meeting) => meeting.id) },
        deletedAt: null,
        parseStatus: "SUCCESS",
      },
    });
    const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
    if (!sourceById.size) return [];
    const chunks = await prisma.meeting_chunks.findMany({
      where: {
        meetingId: { in: meetings.map((meeting) => meeting.id) },
        sourceId: { in: [...sourceById.keys()] },
      },
    });
    const meetingById = new Map(
      meetings.map((meeting) => [meeting.id, meeting])
    );
    return chunks
      .flatMap((chunk) => {
        const meeting = meetingById.get(chunk.meetingId);
        const source = sourceById.get(chunk.sourceId);
        if (!meeting || !source || chunk.generation !== meeting.generation)
          return [];
        const embedding = parseJson(chunk.embedding, null);
        const score = cosine(queryVector, embedding);
        if (score < 0) return [];
        return [
          {
            id: chunk.id,
            meetingId: meeting.id,
            sourceId: source.id,
            sourceType: source.sourceType,
            name: source.name,
            location: parseJson(chunk.location, null),
            quote: chunk.text,
            text: chunk.text,
            score,
            reviewStatus: meeting.reviewStatus,
            coverage: parseJson(meeting.coverage, meeting.coverage),
          },
        ];
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, safeLimit);
  }

  async function reindex(meetingId, { job } = {}) {
    const id = Number(meetingId);
    const meeting = await prisma.meetings.findUnique({ where: { id } });
    if (
      !meeting ||
      meeting.deletedAt ||
      meeting.retrievalStatus === RETRIEVAL.DELETED
    )
      return { stale: true, count: 0 };
    const generation = Number(meeting.generation || 0);
    const sourceSnapshot = await prisma.meeting_sources.findMany({
      where: { meetingId: id, deletedAt: null },
    });
    const snapshotKey = (rows) =>
      JSON.stringify(
        rows
          .map((source) => ({
            id: source.id,
            contentHash: source.contentHash ?? null,
            parseStatus: source.parseStatus,
            deletedAt: source.deletedAt ?? null,
          }))
          .sort((a, b) => a.id - b.id)
      );
    const sourceSnapshotKey = snapshotKey(sourceSnapshot);
    const sources = await prisma.meeting_sources.findMany({
      where: { meetingId: id, deletedAt: null, parseStatus: "SUCCESS" },
    });
    const segments = [];
    const sourceRevisions = new Map();
    for (const source of sources) {
      let current = parseJson(source.segments, []);
      if (!Array.isArray(current) && Array.isArray(current?.segments))
        current = current.segments;
      if (
        source.sourceType === "SUMMARY" &&
        meeting.summary != null &&
        meeting.summary !== source.contentText
      ) {
        current = splitCurrentText(meeting.summary);
        sourceRevisions.set(source.id, {
          segments: current,
          contentText: meeting.summary,
        });
      }
      if (
        source.sourceType === "TRANSCRIPT" &&
        meeting.transcript != null &&
        meeting.transcript !== source.contentText
      ) {
        current = splitCurrentText(meeting.transcript);
        sourceRevisions.set(source.id, {
          segments: current,
          contentText: meeting.transcript,
        });
      }
      const valid = Array.isArray(current)
        ? current.filter(
            (segment) =>
              typeof segment?.text === "string" &&
              segment.text.trim() &&
              segment.location
          )
        : [];
      for (const segment of valid)
        segments.push({ ...segment, sourceId: source.id });
    }
    const prepared = segments.length ? await prepare(segments) : [];
    const preparedBySource = new Map();
    for (const chunk of prepared) {
      const sourceId = chunk.sourceId;
      const target = preparedBySource.get(sourceId) || [];
      target.push(chunk);
      preparedBySource.set(sourceId, target);
    }
    const publish = async (tx) => {
      const current = await tx.meetings.findUnique({ where: { id } });
      if (
        !current ||
        current.deletedAt ||
        current.retrievalStatus === RETRIEVAL.DELETED ||
        current.generation !== generation
      )
        return { stale: true, count: 0 };
      if (job?.leaseOwner) {
        const lease = await tx.meeting_jobs.findUnique({
          where: { id: Number(job.id) },
        });
        if (
          !lease ||
          lease.status !== "PROCESSING" ||
          lease.leaseOwner !== job.leaseOwner ||
          !lease.leaseUntil ||
          new Date(lease.leaseUntil).getTime() <= Date.now()
        )
          return { stale: true, count: 0, leaseLost: true };
      }
      const active = await tx.meeting_sources.findMany({
        where: { meetingId: id, deletedAt: null },
      });
      if (snapshotKey(active) !== sourceSnapshotKey) {
        const sourceSetRevision = crypto
          .createHash("sha256")
          .update(snapshotKey(active))
          .digest("hex");
        const activeKey = `REINDEX:${id}:${generation}:SOURCES:${sourceSetRevision}`;
        const existing = await tx.meeting_jobs.findFirst({
          where: { activeKey, status: { in: ["CREATED", "PROCESSING"] } },
        });
        if (!existing)
          await tx.meeting_jobs.create({
            data: {
              kind: "REINDEX",
              meetingId: id,
              connectionId: current.connectionId,
              externalId: current.externalId,
              quarter: current.quarter,
              activeKey,
              payload: JSON.stringify({ generation, sourceSetRevision }),
              status: "CREATED",
              attempts: 0,
            },
          });
        return { stale: true, count: 0, sourceSetChanged: true };
      }
      const successful = active.filter(
        (source) => source.parseStatus === "SUCCESS"
      );
      const activeIds = new Set(successful.map((source) => source.id));
      await tx.meeting_chunks.deleteMany({ where: { meetingId: id } });
      for (const [sourceId, revision] of sourceRevisions) {
        const source = successful.find((row) => row.id === sourceId);
        if (!source) continue;
        const contentHash = hashText(revision.contentText);
        await tx.meeting_sources.update({
          where: { id: sourceId },
          data: {
            contentText: revision.contentText,
            contentHash,
            activeHash: `${source.sourceType}:${contentHash}`,
            segments: JSON.stringify(revision.segments),
          },
        });
      }
      let count = 0;
      for (const [sourceId, sourceChunks] of preparedBySource) {
        if (!activeIds.has(sourceId)) continue;
        for (const chunk of sourceChunks) {
          await tx.meeting_chunks.create({
            data: {
              meetingId: id,
              sourceId,
              text: chunk.text,
              location: JSON.stringify(chunk.location),
              embedding: JSON.stringify(chunk.embedding),
              generation,
            },
          });
          count += 1;
        }
      }
      await tx.meetings.update({
        where: { id },
        data: {
          retrievalStatus: count
            ? RETRIEVAL.AVAILABLE
            : RETRIEVAL.WAITING_CONTENT,
        },
      });
      return { stale: false, count, generation };
    };
    return typeof prisma.$transaction === "function"
      ? prisma.$transaction(publish)
      : publish(prisma);
  }

  return { prepare, reindex, search };
}

function splitCurrentText(value) {
  return String(value || "")
    .split(/\r?\n+/)
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text, paragraph) => ({
      text,
      location: { type: "paragraph", paragraph },
    }));
}

module.exports = { createIndexer };
