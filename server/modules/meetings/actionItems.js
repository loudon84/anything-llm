const crypto = require("crypto");
const { MeetingError } = require("./errors");

const DEFAULT_MAX_ITEMS = 50;
const MAX_CANDIDATES = 50;

const CANDIDATE_KIND = Object.freeze({ AUTO: "auto", MANUAL: "manual" });
const CANDIDATE_STATUS = Object.freeze({
  PENDING: "pending",
  CREATED: "created",
  NEEDS_CONFIRM: "needs_confirm",
});

/** Minutes-style GATEWAY_ARTIFACT groups from gatewayImporter GROUPS. */
const MINUTES_KEY_RE = /(?:^|[^a-z0-9])(?:ai_[a-z0-9_]*minutes|minutes)(?:$|[^a-z0-9])/i;

/** Whitelist titles after whitespace removal; EN matched case-insensitively. */
const WHITELIST_NORMALIZED = new Set([
  "待办事项",
  "行动项",
  "actionitems",
  "actionitem",
  "todo",
  "to-do",
]);

const ATX_HEADING_RE = /^(#{1,6})\s+(.*)$/;
const LIST_ITEM_RE = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

/**
 * Normalize an excerpt for stable candidate identity / fingerprinting.
 * Collapses CR/LF, trims lines, and squeezes horizontal whitespace.
 * @param {string} text
 * @returns {string}
 */
function normalizeExcerpt(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripWhitespace(value) {
  return String(value ?? "").replace(/\s+/g, "");
}

/**
 * @param {string} rawTitle text after ATX markers / full-line body
 * @returns {boolean}
 */
function isWhitelistHeadingTitle(rawTitle) {
  let title = String(rawTitle ?? "").trim();
  if (title.endsWith(":")) title = title.slice(0, -1).trim();
  const normalized = stripWhitespace(title).toLowerCase();
  return WHITELIST_NORMALIZED.has(normalized);
}

/**
 * @param {string} line
 * @returns {{ kind: 'atx'|'plain'|null, title: string|null, isWhitelist: boolean }}
 */
function classifyHeading(line) {
  const trimmed = String(line ?? "").trimEnd();
  const atx = trimmed.match(ATX_HEADING_RE);
  if (atx) {
    const title = atx[2].trim();
    return {
      kind: "atx",
      title,
      isWhitelist: isWhitelistHeadingTitle(title),
    };
  }
  const plain = trimmed.trim();
  if (!plain) return { kind: null, title: null, isWhitelist: false };
  if (isWhitelistHeadingTitle(plain)) {
    return { kind: "plain", title: plain, isWhitelist: true };
  }
  return { kind: null, title: null, isWhitelist: false };
}

function parseListItem(line) {
  const match = String(line ?? "").match(LIST_ITEM_RE);
  if (!match) return null;
  const indent = match[1].replace(/\t/g, "  ").length;
  return {
    indent,
    text: match[3],
    raw: line,
  };
}

/**
 * Slice candidates from lines under a whitelist heading until the next heading.
 * @param {string[]} lines
 * @param {number} startIndex first content line after the heading
 * @returns {{ items: Array<{ title: string, description: string, sourceExcerpt: string }>, nextIndex: number }}
 */
function extractSectionItems(lines, startIndex) {
  const sectionLines = [];
  let index = startIndex;
  while (index < lines.length) {
    const heading = classifyHeading(lines[index]);
    if (heading.kind === "atx" || heading.isWhitelist) break;
    sectionLines.push(lines[index]);
    index += 1;
  }

  const parsed = sectionLines.map((line, offset) => ({
    line,
    offset,
    list: parseListItem(line),
  }));
  const hasTopLevelList = parsed.some(
    (entry) => entry.list && entry.list.indent === 0
  );

  /** @type {Array<{ title: string, description: string, sourceExcerpt: string }>} */
  const items = [];

  if (hasTopLevelList) {
    let current = null;
    for (const entry of parsed) {
      if (!entry.list) {
        if (current && String(entry.line).trim()) {
          current.descriptionParts.push(String(entry.line).trim());
          current.rawLines.push(entry.line);
        }
        continue;
      }
      if (entry.list.indent === 0) {
        if (current) {
          items.push(finalizeListItem(current));
        }
        current = {
          title: entry.list.text.trim(),
          descriptionParts: [],
          rawLines: [entry.line],
        };
      } else if (current) {
        current.descriptionParts.push(entry.list.text.trim());
        current.rawLines.push(entry.line);
      }
    }
    if (current) items.push(finalizeListItem(current));
  } else {
    for (const entry of parsed) {
      const text = String(entry.line).trim();
      if (!text) continue;
      items.push({
        title: text,
        description: "",
        sourceExcerpt: entry.line,
      });
    }
  }

  return { items, nextIndex: index };
}

function finalizeListItem(current) {
  return {
    title: current.title,
    description: current.descriptionParts.filter(Boolean).join("\n"),
    sourceExcerpt: current.rawLines.join("\n"),
  };
}

function sourceBody(source) {
  if (source == null) return "";
  if (typeof source === "string") return source;
  return (
    source.contentText ?? source.content ?? source.text ?? source.body ?? ""
  );
}

function sourceOriginKey(source) {
  if (source == null || typeof source === "string") return "";
  return String(source.originKey ?? "");
}

/**
 * Pure extractor: whitelist action-item headings → candidate records (no LLM).
 *
 * @param {Array<{ originKey?: string, contentText?: string, content?: string, text?: string }|string>} sources
 * @param {{ maxItems?: number }} [options]
 * @returns {Array<{
 *   candidateId: string,
 *   title: string,
 *   description: string,
 *   sourceExcerpt: string,
 *   originKey: string,
 *   sourceFingerprint: string
 * }>}
 */
function extractActionItems(sources = [], { maxItems = DEFAULT_MAX_ITEMS } = {}) {
  const limit = Number.isFinite(Number(maxItems))
    ? Math.max(0, Math.floor(Number(maxItems)))
    : DEFAULT_MAX_ITEMS;

  /** @type {typeof sources} */
  const uniqueSources = [];
  const seenOrigin = new Set();
  for (const source of Array.isArray(sources) ? sources : []) {
    const originKey = sourceOriginKey(source);
    if (originKey) {
      if (seenOrigin.has(originKey)) continue;
      seenOrigin.add(originKey);
    }
    uniqueSources.push(source);
  }

  /** @type {ReturnType<typeof extractActionItems>} */
  const candidates = [];

  for (const source of uniqueSources) {
    if (candidates.length >= limit) break;
    const originKey = sourceOriginKey(source);
    const body = String(sourceBody(source) ?? "");
    const lines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

    let lineIndex = 0;
    while (lineIndex < lines.length && candidates.length < limit) {
      const heading = classifyHeading(lines[lineIndex]);
      if (!heading.isWhitelist) {
        lineIndex += 1;
        continue;
      }
      const { items, nextIndex } = extractSectionItems(lines, lineIndex + 1);
      for (const item of items) {
        if (candidates.length >= limit) break;
        if (!item.title) continue;
        const normalized = normalizeExcerpt(item.sourceExcerpt);
        const sourceFingerprint = sha256Hex(normalized);
        const candidateId = sha256Hex(`${originKey}\n${normalized}`);
        candidates.push({
          candidateId,
          title: item.title,
          description: item.description || "",
          sourceExcerpt: item.sourceExcerpt,
          originKey,
          sourceFingerprint,
        });
      }
      lineIndex = nextIndex;
    }
  }

  return candidates;
}

/**
 * Sources useful for action-item extraction (D-ACT-01 + Task 7).
 * SUMMARY / LOCAL_SUMMARY, plus GATEWAY_ARTIFACT (or name/origin) minutes / ai_* minutes.
 *
 * @param {object} source
 * @param {{ requireSuccess?: boolean }} [options]
 * @returns {boolean}
 */
function isExtractionSource(source, { requireSuccess = true } = {}) {
  if (!source || source.deletedAt != null) return false;
  if (
    requireSuccess &&
    source.parseStatus != null &&
    String(source.parseStatus) !== "SUCCESS"
  ) {
    return false;
  }
  const type = String(source.sourceType || "");
  if (type === "SUMMARY" || type === "LOCAL_SUMMARY") return true;
  const key = `${source.originKey || ""} ${source.name || ""} ${type}`.toLowerCase();
  if (type === "GATEWAY_ARTIFACT" || type === "SUPPLEMENT_TEXT" || type === "SUPPLEMENT_FILE") {
    return MINUTES_KEY_RE.test(key) || /ai_[a-z0-9_]*minutes/.test(key);
  }
  return MINUTES_KEY_RE.test(key) || /ai_[a-z0-9_]*minutes/.test(key);
}

async function loadExtractionSources(prisma, meetingId) {
  const rows = await prisma.meeting_sources.findMany({
    where: {
      meetingId: Number(meetingId),
      deletedAt: null,
      parseStatus: "SUCCESS",
    },
    orderBy: { id: "asc" },
  });
  return rows.filter((row) => isExtractionSource(row, { requireSuccess: true }));
}

function publicCandidate(row) {
  if (!row) return row;
  return {
    id: row.id,
    meetingId: row.meetingId,
    candidateId: row.candidateId,
    kind: row.kind,
    status: row.status,
    originKey: row.originKey ?? null,
    sourceFingerprint: row.sourceFingerprint ?? null,
    title: row.title,
    description: row.description ?? "",
    sourceExcerpt: row.sourceExcerpt ?? null,
    taskId: row.taskId ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Soft-sync auto candidates from extractable sources.
 * Upserts matching candidateIds; marks vanished pending autos as needs_confirm;
 * never deletes rows or tasks. New unmatched → pending on first sync, needs_confirm on drift.
 *
 * @param {number|string} meetingId
 * @param {{ prisma: object, sources?: object[] }} options
 */
async function syncActionCandidates(meetingId, { prisma, sources } = {}) {
  if (!prisma?.meeting_action_candidates)
    throw new TypeError("syncActionCandidates requires prisma.meeting_action_candidates");
  const id = Number(meetingId);
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new MeetingError("Meeting ID must be a positive integer", "INVALID_ID", 400);

  const extractionSources = Array.isArray(sources)
    ? sources.filter((row) => isExtractionSource(row, { requireSuccess: false }))
    : await loadExtractionSources(prisma, id);

  const extracted = extractActionItems(extractionSources, {
    maxItems: MAX_CANDIDATES,
  });
  const extractedById = new Map(
    extracted.map((item) => [item.candidateId, item])
  );

  const existing = await prisma.meeting_action_candidates.findMany({
    where: { meetingId: id },
    orderBy: { id: "asc" },
  });
  const existingById = new Map(
    existing.map((row) => [row.candidateId, row])
  );
  const priorAutos = existing.filter(
    (row) => row.kind === CANDIDATE_KIND.AUTO
  );
  const hadPriorAutos = priorAutos.length > 0;
  const newAutoStatus = hadPriorAutos
    ? CANDIDATE_STATUS.NEEDS_CONFIRM
    : CANDIDATE_STATUS.PENDING;

  for (const item of extracted) {
    const prior = existingById.get(item.candidateId);
    if (prior) {
      await prisma.meeting_action_candidates.update({
        where: { id: prior.id },
        data: {
          originKey: item.originKey || prior.originKey || null,
          sourceFingerprint:
            item.sourceFingerprint || prior.sourceFingerprint || null,
          title: item.title,
          description: item.description || "",
          sourceExcerpt: item.sourceExcerpt || null,
        },
      });
      continue;
    }
    if (existing.length >= MAX_CANDIDATES) continue;
    const created = await prisma.meeting_action_candidates.create({
      data: {
        meetingId: id,
        candidateId: item.candidateId,
        kind: CANDIDATE_KIND.AUTO,
        status: newAutoStatus,
        originKey: item.originKey || null,
        sourceFingerprint: item.sourceFingerprint || null,
        title: item.title,
        description: item.description || "",
        sourceExcerpt: item.sourceExcerpt || null,
        taskId: null,
      },
    });
    existing.push(created);
    existingById.set(created.candidateId, created);
  }

  for (const prior of priorAutos) {
    if (extractedById.has(prior.candidateId)) continue;
    if (prior.status !== CANDIDATE_STATUS.PENDING) continue;
    await prisma.meeting_action_candidates.update({
      where: { id: prior.id },
      data: { status: CANDIDATE_STATUS.NEEDS_CONFIRM },
    });
  }

  const rows = await prisma.meeting_action_candidates.findMany({
    where: { meetingId: id },
    orderBy: { id: "asc" },
  });
  return rows.map(publicCandidate);
}

async function listActionCandidates(meetingId, { prisma } = {}) {
  if (!prisma?.meeting_action_candidates)
    throw new TypeError("listActionCandidates requires prisma.meeting_action_candidates");
  const id = Number(meetingId);
  const rows = await prisma.meeting_action_candidates.findMany({
    where: { meetingId: id },
    orderBy: { id: "asc" },
  });
  return rows.map(publicCandidate);
}

async function createManualCandidate(
  meetingId,
  { title, description } = {},
  { prisma } = {}
) {
  if (!prisma?.meeting_action_candidates)
    throw new TypeError("createManualCandidate requires prisma.meeting_action_candidates");
  const id = Number(meetingId);
  const trimmed = String(title ?? "").trim();
  if (!trimmed)
    throw new MeetingError(
      "Action candidate title is required",
      "CANDIDATE_TITLE_REQUIRED",
      400
    );

  const count = await prisma.meeting_action_candidates.count({
    where: { meetingId: id },
  });
  if (count >= MAX_CANDIDATES)
    throw new MeetingError(
      "Meeting already has the maximum of 50 action candidates",
      "CANDIDATE_LIMIT",
      409
    );

  const row = await prisma.meeting_action_candidates.create({
    data: {
      meetingId: id,
      candidateId: crypto.randomUUID(),
      kind: CANDIDATE_KIND.MANUAL,
      status: CANDIDATE_STATUS.PENDING,
      originKey: null,
      sourceFingerprint: null,
      title: trimmed,
      description:
        description == null || description === undefined
          ? ""
          : String(description),
      sourceExcerpt: null,
      taskId: null,
    },
  });
  return publicCandidate(row);
}

async function updateActionCandidate(
  meetingId,
  candidateId,
  { title, description } = {},
  { prisma } = {}
) {
  if (!prisma?.meeting_action_candidates)
    throw new TypeError("updateActionCandidate requires prisma.meeting_action_candidates");
  const id = Number(meetingId);
  const key = String(candidateId || "");
  if (!key)
    throw new MeetingError(
      "Action candidate ID is required",
      "CANDIDATE_NOT_FOUND",
      404
    );

  const existing = await prisma.meeting_action_candidates.findFirst({
    where: { meetingId: id, candidateId: key },
  });
  if (!existing)
    throw new MeetingError(
      "Action candidate not found",
      "CANDIDATE_NOT_FOUND",
      404
    );

  const data = {};
  if (title !== undefined) {
    const trimmed = String(title ?? "").trim();
    if (!trimmed)
      throw new MeetingError(
        "Action candidate title is required",
        "CANDIDATE_TITLE_REQUIRED",
        400
      );
    data.title = trimmed;
  }
  if (description !== undefined) {
    data.description =
      description == null ? "" : String(description);
  }
  if (Object.keys(data).length === 0) return publicCandidate(existing);

  const row = await prisma.meeting_action_candidates.update({
    where: { id: existing.id },
    data,
  });
  return publicCandidate(row);
}

module.exports = {
  extractActionItems,
  normalizeExcerpt,
  isWhitelistHeadingTitle,
  isExtractionSource,
  syncActionCandidates,
  listActionCandidates,
  createManualCandidate,
  updateActionCandidate,
  publicCandidate,
  DEFAULT_MAX_ITEMS,
  MAX_CANDIDATES,
  CANDIDATE_KIND,
  CANDIDATE_STATUS,
};
