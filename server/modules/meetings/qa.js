const crypto = require("crypto");
const { MeetingError } = require("./errors");
const { LIMITS, RETRIEVAL } = require("./constants");
const { assertQueryable } = require("./policy");
const {
  buildGroundedPrompt,
  validateGroundedResponse,
  GROUNDING_SYSTEM_POLICY,
} = require("./grounding");

const parse = (value, fallback) => {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};
const stable = (value) => JSON.stringify(value);
const digest = (value) =>
  crypto.createHash("sha256").update(stable(value)).digest("hex");

function normalizeIds(values, label, { max, min = 1 } = {}) {
  if (!Array.isArray(values) || values.length < min) {
    throw new MeetingError(
      `Select at least ${min} ${label}`,
      `INVALID_${label.toUpperCase()}_SCOPE`
    );
  }
  const ids = values.map(Number);
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new MeetingError(
      `Every ${label} ID must be a positive integer`,
      `INVALID_${label.toUpperCase()}_SCOPE`
    );
  }
  if (new Set(ids).size !== ids.length) {
    throw new MeetingError(
      `${label} IDs must be unique`,
      `DUPLICATE_${label.toUpperCase()}_SCOPE`
    );
  }
  if (max && ids.length > max)
    throw new MeetingError(
      `Select no more than ${max} ${label}`,
      `${label.toUpperCase()}_SCOPE_LIMIT`
    );
  return ids;
}

const MAX_QUESTION_LENGTH = 2000;
const MAX_CLARIFICATION_LENGTH = 2000;
const MAX_REFERENCE_LENGTH = 1200;

function boundedText(value, limit, label) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > limit) {
    throw new MeetingError(
      `${label} must be ${limit} characters or fewer`,
      `INVALID_${label.toUpperCase().replace(/\s+/g, "_")}`
    );
  }
  const text = value.trim();
  return text || null;
}

function referenceText(value, limit) {
  return typeof value === "string"
    ? value.trim().slice(0, limit) || null
    : null;
}

function scopeBlockReason(manifest) {
  const unavailable = manifest.find(
    ({ meeting }) =>
      meeting.retrievalStatus !== RETRIEVAL.AVAILABLE || meeting.deletedAt
  );
  if (!unavailable) return null;
  const status = unavailable.meeting.retrievalStatus || "DELETED";
  return `Selected meeting ${unavailable.meeting.id} is unavailable (${status})`;
}

function answerSourceState(manifest, citations) {
  const sources = new Map();
  for (const meeting of manifest) {
    for (const source of meeting.sources) {
      sources.set(`${meeting.meeting.id}:${source.id}`, {
        meetingId: meeting.meeting.id,
        ...source,
      });
    }
  }
  const citedSources = [];
  const seen = new Set();
  for (const citation of citations) {
    if (
      citation.sourceType === "WORKSPACE" &&
      citation.workspaceId != null &&
      citation.documentId != null &&
      citation.revision != null
    ) {
      const key = `workspace:${citation.workspaceId}:${citation.documentId}:${citation.revision}`;
      if (!seen.has(key)) {
        seen.add(key);
        citedSources.push({
          sourceType: "WORKSPACE",
          workspaceId: Number(citation.workspaceId),
          documentId: String(citation.documentId),
          revision: citation.revision,
        });
      }
      continue;
    }
    if (citation.meetingId == null || citation.sourceId == null) continue;
    const key = `${citation.meetingId}:${citation.sourceId}`;
    if (!seen.has(key) && sources.has(key)) {
      seen.add(key);
      citedSources.push(citationSourceRevision(sources.get(key)));
    }
  }
  return { manifest, citedSources };
}

function sourceStateParts(value) {
  const parsed = parse(value, []);
  return Array.isArray(parsed)
    ? { manifest: parsed, citedSources: [] }
    : {
        manifest: Array.isArray(parsed?.manifest) ? parsed.manifest : [],
        citedSources: Array.isArray(parsed?.citedSources)
          ? parsed.citedSources
          : [],
      };
}

function citationSourceRevision(source) {
  const revision = { ...source };
  delete revision.retrievable;
  return revision;
}

function createQAService({
  prisma,
  indexer,
  workspaceRetriever,
  llm,
  audit = async () => {},
} = {}) {
  if (
    !prisma ||
    !indexer ||
    !workspaceRetriever ||
    !llm ||
    typeof llm.generate !== "function"
  ) {
    throw new TypeError(
      "createQAService requires prisma, indexer, workspaceRetriever, and a configured llm adapter"
    );
  }
  const transaction = (callback) =>
    typeof prisma.$transaction === "function"
      ? prisma.$transaction(callback)
      : callback(prisma);

  async function currentMeetings(
    meetingIds,
    db = prisma,
    requireAvailable = true
  ) {
    const rows = await db.meetings.findMany({
      where: { id: { in: meetingIds } },
    });
    if (requireAvailable && rows.length !== meetingIds.length)
      throw new MeetingError(
        "A selected meeting is unavailable",
        "MEETING_UNAVAILABLE",
        409
      );
    if (
      requireAvailable &&
      rows.some(
        (meeting) =>
          meeting.deletedAt || meeting.retrievalStatus === RETRIEVAL.DELETED
      )
    ) {
      throw new MeetingError(
        "Every selected meeting must be available before querying",
        "MEETING_UNAVAILABLE",
        409
      );
    }
    return requireAvailable ? assertQueryable(rows) : rows;
  }

  async function assertOwner(id, userId) {
    const conversation = await prisma.meeting_conversations.findUnique({
      where: { id: Number(id) },
    });
    if (!conversation)
      throw new MeetingError(
        "Conversation not found",
        "CONVERSATION_NOT_FOUND",
        404
      );
    if ((conversation.createdBy ?? null) !== (userId ?? null)) {
      throw new MeetingError(
        "Conversation is unavailable to this user",
        "CONVERSATION_FORBIDDEN",
        403
      );
    }
    return conversation;
  }

  async function assertWorkspaceScope(conversation, userId) {
    const workspaceIds = parse(conversation.workspaceIds, []);
    if (typeof workspaceRetriever.resolve !== "function") {
      throw new MeetingError(
        "Workspace access checking is not configured",
        "WORKSPACE_ACCESS_FAILED",
        503
      );
    }
    await workspaceRetriever.resolve({ workspaceIds, userId });
    return workspaceIds;
  }

  async function snapshot(meetingIds, db = prisma) {
    const meetings = await currentMeetings(meetingIds, db, false);
    const ordered = [...meetings].sort((a, b) => a.id - b.id);
    const byId = new Map(ordered.map((meeting) => [meeting.id, meeting]));
    for (const id of meetingIds) {
      if (!byId.has(id))
        byId.set(id, {
          id,
          generation: null,
          retrievalStatus: "DELETED",
          updatedAt: null,
        });
    }
    const sourceSets = [];
    for (const meeting of [...byId.values()].sort((a, b) => a.id - b.id)) {
      const rows = await db.meeting_sources.findMany({
        where: { meetingId: meeting.id, deletedAt: null },
      });
      const active = rows
        .filter((source) => source.deletedAt == null)
        .map((source) => ({
          id: source.id,
          sourceType: source.sourceType,
          name: source.name,
          contentHash: source.contentHash ?? null,
          activeHash: source.activeHash ?? null,
          parseStatus: source.parseStatus,
          originalAvailable:
            ["SUPPLEMENT_FILE", "TENCENT_ORIGINAL"].includes(
              source.sourceType
            ) && Boolean(source.filePath),
          updatedAt: source.updatedAt
            ? new Date(source.updatedAt).toISOString()
            : null,
        }))
        .sort((a, b) => a.id - b.id);
      const chunks = await db.meeting_chunks.findMany({
        where: { meetingId: meeting.id },
      });
      const currentChunkSources = new Set(
        chunks
          .filter((chunk) => chunk.generation === meeting.generation)
          .map((chunk) => chunk.sourceId)
      );
      for (const source of active) {
        source.retrievable =
          meeting.retrievalStatus === RETRIEVAL.AVAILABLE &&
          source.parseStatus === "SUCCESS" &&
          currentChunkSources.has(source.id);
      }
      sourceSets.push({
        meeting: {
          id: meeting.id,
          generation: meeting.generation,
          retrievalStatus: meeting.retrievalStatus,
          deletedAt: meeting.deletedAt ?? null,
          updatedAt: meeting.updatedAt
            ? new Date(meeting.updatedAt).toISOString()
            : null,
        },
        sources: active,
      });
    }
    return sourceSets;
  }

  function compareSnapshots(savedValue, currentValue, workspaceStale = false) {
    const saved = sourceStateParts(savedValue);
    const previousManifest = saved.manifest;
    const current = currentValue;
    const savedMeetings = new Map(
      previousManifest.map((item) => [item.meeting.id, item])
    );
    let stale = workspaceStale;
    let newSources = false;
    const sourceByKey = new Map(
      current.flatMap((item) =>
        item.sources.map((source) => [
          `${item.meeting.id}:${source.id}`,
          { meetingId: item.meeting.id, ...source },
        ])
      )
    );
    for (const cited of saved.citedSources) {
      if (cited.sourceType === "WORKSPACE") continue;
      const latest = sourceByKey.get(`${cited.meetingId}:${cited.id}`);
      if (!latest) {
        stale = true;
        continue;
      }
      if (stable(citationSourceRevision(latest)) !== stable(cited))
        stale = true;
    }
    for (const item of current) {
      const prior = savedMeetings.get(item.meeting.id);
      const previousRetrievable = new Map(
        (prior?.sources || [])
          .filter((source) => source.retrievable)
          .map((source) => [source.id, source])
      );
      if (item.meeting.retrievalStatus !== RETRIEVAL.AVAILABLE) continue;
      for (const source of item.sources.filter(
        (candidate) => candidate.retrievable
      )) {
        const previous = previousRetrievable.get(source.id);
        if (!previous || stable(previous) !== stable(source)) newSources = true;
      }
    }
    return { stale, newSources, blockedReason: scopeBlockReason(current) };
  }

  async function workspaceCitationsChanged(
    savedValue,
    { workspaceIds, userId, db = prisma } = {}
  ) {
    const citations = sourceStateParts(savedValue).citedSources.filter(
      (item) => item.sourceType === "WORKSPACE"
    );
    if (!citations.length) return false;
    if (typeof workspaceRetriever.validateEvidence !== "function") return true;
    return !(await workspaceRetriever.validateEvidence({
      workspaceIds,
      userId,
      evidence: citations,
      db,
    }));
  }

  async function historyAnswer(answer, current, scope) {
    const workspaceStale = await workspaceCitationsChanged(
      answer.sourceState,
      scope
    );
    return {
      ...answer,
      citations: parse(answer.citations, []),
      sourceState: parse(answer.sourceState, []),
      ...compareSnapshots(answer.sourceState, current, workspaceStale),
    };
  }

  async function createConversation(scope = {}, userId) {
    const meetingIds = normalizeIds(scope.meetingIds, "meeting", {
      max: LIMITS.selectedMeetings,
    });
    const workspaceIds = normalizeIds(scope.workspaceIds ?? [], "workspace", {
      min: 0,
    });
    await currentMeetings(meetingIds);
    if (typeof workspaceRetriever.resolve !== "function")
      throw new MeetingError(
        "Workspace access checking is not configured",
        "WORKSPACE_ACCESS_FAILED",
        503
      );
    await workspaceRetriever.resolve({ workspaceIds, userId });
    const row = await transaction(async (db) => {
      const created = await db.meeting_conversations.create({
        data: {
          meetingIds: JSON.stringify(meetingIds),
          workspaceIds: JSON.stringify(workspaceIds),
          createdBy: userId ?? null,
        },
      });
      await audit(
        {
          action: "MEETING_CONVERSATION_CREATED",
          conversationId: created.id,
          meetingIds,
          workspaceIds,
          userId: userId ?? null,
        },
        db
      );
      return created;
    });
    return { ...row, meetingIds, workspaceIds };
  }

  async function listConversations(userId) {
    const rows = await prisma.meeting_conversations.findMany({
      where: { createdBy: userId ?? null },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      meetingIds: parse(row.meetingIds, []),
      workspaceIds: parse(row.workspaceIds, []),
    }));
  }

  async function getConversation(id, userId) {
    const row = await assertOwner(id, userId);
    const meetingIds = parse(row.meetingIds, []);
    const workspaceIds = await assertWorkspaceScope(row, userId);
    const current = await snapshot(meetingIds);
    const answers = await prisma.meeting_answers.findMany({
      where: { conversationId: row.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      ...row,
      meetingIds,
      workspaceIds,
      scopeState: {
        available: !scopeBlockReason(current),
        blockedReason: scopeBlockReason(current),
      },
      answers: await Promise.all(
        answers.map((answer) =>
          historyAnswer(answer, current, { workspaceIds, userId })
        )
      ),
    };
  }

  async function history(id, userId) {
    const conversation = await assertOwner(id, userId);
    const meetingIds = parse(conversation.meetingIds, []);
    const workspaceIds = await assertWorkspaceScope(conversation, userId);
    const current = await snapshot(meetingIds);
    const answers = await prisma.meeting_answers.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    return {
      conversation: {
        ...conversation,
        meetingIds,
        workspaceIds,
        scopeState: {
          available: !scopeBlockReason(current),
          blockedReason: scopeBlockReason(current),
        },
      },
      answers: await Promise.all(
        answers.map((answer) =>
          historyAnswer(answer, current, { workspaceIds, userId })
        )
      ),
    };
  }

  async function ask(id, input = {}, userId) {
    const conversation = await assertOwner(id, userId);
    const meetingIds = parse(conversation.meetingIds, []);
    const workspaceIds = await assertWorkspaceScope(conversation, userId);
    const question = boundedText(
      input.question,
      MAX_QUESTION_LENGTH,
      "question"
    );
    if (!question)
      throw new MeetingError("A question is required", "QUESTION_REQUIRED");
    let previous = null;
    const previousAnswerId =
      input.previousAnswerId == null ? null : Number(input.previousAnswerId);
    if (previousAnswerId != null) {
      previous = await prisma.meeting_answers.findUnique({
        where: { id: previousAnswerId },
      });
      if (!previous || previous.conversationId !== conversation.id)
        throw new MeetingError(
          "Prior answer is unavailable",
          "ANSWER_NOT_FOUND",
          404
        );
    }
    await currentMeetings(meetingIds);
    const before = await snapshot(meetingIds);
    const baselineBlock = scopeBlockReason(before);
    if (baselineBlock) {
      const unavailableAnswer = await transaction(async (db) => {
        const row = await db.meeting_answers.create({
          data: {
            conversationId: conversation.id,
            question,
            clarification:
              boundedText(
                input.clarification,
                MAX_CLARIFICATION_LENGTH,
                "clarification"
              ) ||
              previous?.clarification ||
              null,
            status: "FAILED_STALE",
            text: null,
            missingInfo: null,
            citations: JSON.stringify([]),
            sourceState: JSON.stringify(answerSourceState(before, [])),
            previousAnswerId,
            error: baselineBlock,
          },
        });
        await audit(
          {
            action: "MEETING_ANSWER_BLOCKED_UNAVAILABLE",
            conversationId: conversation.id,
            answerId: row.id,
            userId: userId ?? null,
          },
          db
        );
        return row;
      });
      const unavailable = new MeetingError(
        baselineBlock,
        "MEETING_UNAVAILABLE",
        409
      );
      unavailable.answerId = unavailableAnswer.id;
      throw unavailable;
    }
    await currentMeetings(meetingIds);
    const explicitClarification = boundedText(
      input.clarification,
      MAX_CLARIFICATION_LENGTH,
      "clarification"
    );
    const clarification =
      explicitClarification || previous?.clarification || null;
    const previousQuestion = referenceText(
      previous?.question,
      MAX_REFERENCE_LENGTH
    );
    const previousMissingInfo = referenceText(
      previous?.missingInfo,
      MAX_REFERENCE_LENGTH
    );
    const conversationContext = {
      previousQuestion,
      previousMissingInfo,
      previousAnswerStatus: previous?.status || null,
      clarification,
      note: "Prior answer text and citations are conversation history only, never evidence.",
    };
    const retrievalQuery = [
      `Current question: ${question}`,
      previousQuestion && `Previous question reference: ${previousQuestion}`,
      previousMissingInfo &&
        `Previously requested information: ${previousMissingInfo}`,
      clarification && `Clarified conditions: ${clarification}`,
    ]
      .filter(Boolean)
      .join("\n");
    const meetingEvidence = await indexer.search(meetingIds, retrievalQuery);
    if (!Array.isArray(meetingEvidence))
      throw new MeetingError(
        "Meeting retrieval returned invalid evidence",
        "INVALID_MEETING_EVIDENCE",
        502
      );
    const workspaceEvidence = await workspaceRetriever.search({
      workspaceIds,
      userId,
      question: retrievalQuery,
    });
    if (!Array.isArray(workspaceEvidence))
      throw new MeetingError(
        "Workspace retrieval returned invalid evidence",
        "INVALID_WORKSPACE_EVIDENCE",
        502
      );
    const sourceAvailability = new Map(
      before.flatMap((entry) =>
        entry.sources.map((source) => [source.id, source.originalAvailable])
      )
    );
    const evidence = [
      ...meetingEvidence
        .filter((item) => meetingIds.includes(Number(item.meetingId)))
        .map((item) => ({
          ...item,
          evidenceId: `meeting:${item.id}`,
          quote: String(item.quote || item.text || ""),
          originalUnavailable:
            item.originalUnavailable ??
            (["SUPPLEMENT_FILE", "TENCENT_ORIGINAL"].includes(
              item.sourceType
            ) &&
              !sourceAvailability.get(item.sourceId)),
          originalAvailable:
            item.originalAvailable ??
            sourceAvailability.get(item.sourceId) ??
            false,
          link: item.link || null,
        })),
      ...workspaceEvidence.filter((item) =>
        workspaceIds.includes(Number(item.workspaceId))
      ),
    ].filter((item) => item.quote.trim());
    let result;
    if (!evidence.length) {
      result = {
        status: "AWAITING_SOURCES",
        text: "",
        missingInfo:
          "Current evidence was not found in the selected meetings or Workspaces.",
        citations: [],
      };
    } else {
      try {
        const response = await llm.generate({
          system: `You are a fixed-scope meeting evidence assistant.\n${GROUNDING_SYSTEM_POLICY}`,
          prompt: buildGroundedPrompt({
            question,
            clarification,
            conversationContext,
            evidence,
          }),
          question,
          clarification,
          conversationContext,
          evidence,
          userId,
        });
        result = validateGroundedResponse(response, evidence);
      } catch (error) {
        if (error?.partialText) {
          result = {
            status: "FAILED_INCOMPLETE",
            text: String(error.partialText),
            missingInfo: null,
            citations: [],
            error: String(error?.message || "Answer generation failed"),
          };
        } else if (
          error instanceof MeetingError &&
          error.code !== "CONFLICTING_EVIDENCE"
        ) {
          result = {
            status: "FAILED",
            text: "",
            missingInfo: null,
            citations: [],
            error: error.message,
          };
        } else {
          result = {
            status: error?.partialText ? "FAILED_INCOMPLETE" : "FAILED",
            text: String(error?.partialText || ""),
            missingInfo: null,
            citations: [],
            error: String(error?.message || "Answer generation failed"),
          };
        }
      }
    }
    const publication = await transaction(async (db) => {
      let availabilityError = null;
      let workspaceChanged = false;
      try {
        await currentMeetings(meetingIds, db);
      } catch (error) {
        if (error?.code !== "MEETING_UNAVAILABLE") throw error;
        availabilityError = error;
      }
      const after = await snapshot(meetingIds, db);
      if (
        !availabilityError &&
        typeof workspaceRetriever.validateEvidence === "function"
      )
        workspaceChanged = !(await workspaceRetriever.validateEvidence({
          workspaceIds,
          userId,
          evidence: workspaceEvidence,
          db,
        }));
      if (
        availabilityError ||
        workspaceChanged ||
        digest(before) !== digest(after)
      ) {
        const stale = await db.meeting_answers.create({
          data: {
            conversationId: conversation.id,
            question,
            clarification,
            status: "FAILED_STALE",
            text: null,
            missingInfo: null,
            citations: JSON.stringify([]),
            sourceState: JSON.stringify(answerSourceState(before, [])),
            previousAnswerId,
            error:
              availabilityError?.message ||
              (workspaceChanged
                ? "Selected Workspace document changed while generating the answer"
                : "Selected meeting source set or revision changed while generating the answer"),
          },
        });
        await audit(
          {
            action: "MEETING_ANSWER_BLOCKED_STALE",
            conversationId: conversation.id,
            answerId: stale.id,
            userId: userId ?? null,
          },
          db
        );
        return { stale: true, availabilityError, workspaceChanged };
      }
      const row = await db.meeting_answers.create({
        data: {
          conversationId: conversation.id,
          question,
          clarification,
          status: result.status,
          text: result.text,
          missingInfo: result.missingInfo,
          citations: JSON.stringify(result.citations),
          sourceState: JSON.stringify(
            answerSourceState(before, result.citations)
          ),
          previousAnswerId,
          error: result.error || null,
        },
      });
      await audit(
        {
          action: "MEETING_ANSWER_CREATED",
          conversationId: conversation.id,
          answerId: row.id,
          status: row.status,
          userId: userId ?? null,
        },
        db
      );
      return { stale: false, row };
    });
    if (publication.stale)
      throw new MeetingError(
        publication.availabilityError?.message ||
          (publication.workspaceChanged
            ? "Selected Workspace document changed while generating the answer"
            : "Selected meeting source set or revision changed while generating the answer"),
        publication.availabilityError
          ? "MEETING_UNAVAILABLE"
          : publication.workspaceChanged
            ? "WORKSPACE_SOURCE_CHANGED"
            : "MEETING_SOURCE_CHANGED",
        409
      );
    const row = publication.row;
    return {
      ...row,
      citations: result.citations,
      sourceState: answerSourceState(before, result.citations),
      stale: false,
      newSources: false,
    };
  }

  return {
    createConversation,
    listConversations,
    getConversation,
    ask,
    history,
  };
}

module.exports = { createQAService };
