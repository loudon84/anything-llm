const crypto = require("crypto");
const { MeetingError } = require("./errors");
const { LIMITS, RETRIEVAL } = require("./constants");
const { assertQueryable } = require("./policy");
const {
  buildGroundedPrompt,
  validateGroundedResponse,
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
      sourceSets.push({
        meeting: {
          id: meeting.id,
          generation: meeting.generation,
          retrievalStatus: meeting.retrievalStatus,
          updatedAt: meeting.updatedAt
            ? new Date(meeting.updatedAt).toISOString()
            : null,
        },
        sources: active,
      });
    }
    return sourceSets;
  }

  function compareSnapshots(savedValue, currentValue) {
    const saved = parse(savedValue, []);
    const current = currentValue;
    const savedMeetings = new Map(saved.map((item) => [item.meeting.id, item]));
    let stale = false;
    let newSources = false;
    for (const item of current) {
      const prior = savedMeetings.get(item.meeting.id);
      if (!prior) {
        newSources = true;
        continue;
      }
      if (
        prior.meeting.generation !== item.meeting.generation ||
        item.meeting.retrievalStatus !== RETRIEVAL.AVAILABLE
      )
        stale = true;
      const previous = new Map(
        prior.sources.map((source) => [source.id, source])
      );
      const latest = new Map(item.sources.map((source) => [source.id, source]));
      for (const [id, source] of previous) {
        if (!latest.has(id)) stale = true;
        else if (stable(latest.get(id)) !== stable(source)) {
          stale = true;
          newSources = true;
        }
      }
      for (const id of latest.keys()) if (!previous.has(id)) newSources = true;
    }
    if (saved.length !== current.length) stale = true;
    return { stale, newSources };
  }

  async function createConversation(scope = {}, userId) {
    const meetingIds = normalizeIds(scope.meetingIds, "meeting", {
      max: LIMITS.selectedMeetings,
    });
    const workspaceIds = normalizeIds(scope.workspaceIds, "workspace");
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
      answers: answers.map((answer) => ({
        ...answer,
        citations: parse(answer.citations, []),
        sourceState: parse(answer.sourceState, []),
        ...compareSnapshots(answer.sourceState, current),
      })),
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
      },
      answers: answers.map((answer) => ({
        ...answer,
        citations: parse(answer.citations, []),
        sourceState: parse(answer.sourceState, []),
        ...compareSnapshots(answer.sourceState, current),
      })),
    };
  }

  async function ask(id, input = {}, userId) {
    const conversation = await assertOwner(id, userId);
    const meetingIds = parse(conversation.meetingIds, []);
    const workspaceIds = await assertWorkspaceScope(conversation, userId);
    const question =
      typeof input.question === "string" ? input.question.trim() : "";
    if (!question)
      throw new MeetingError("A question is required", "QUESTION_REQUIRED");
    const previousAnswerId =
      input.previousAnswerId == null ? null : Number(input.previousAnswerId);
    if (previousAnswerId != null) {
      const previous = await prisma.meeting_answers.findUnique?.({
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
    const meetingEvidence = await indexer.search(meetingIds, question);
    if (!Array.isArray(meetingEvidence))
      throw new MeetingError(
        "Meeting retrieval returned invalid evidence",
        "INVALID_MEETING_EVIDENCE",
        502
      );
    const workspaceEvidence = await workspaceRetriever.search({
      workspaceIds,
      userId,
      question,
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
          system:
            "You are a fixed-scope meeting evidence assistant. Follow the grounded answer contract exactly.",
          prompt: buildGroundedPrompt({
            question,
            clarification: input.clarification,
            evidence,
          }),
          question,
          clarification: input.clarification ?? null,
          evidence,
        });
        result = validateGroundedResponse(response, evidence);
      } catch (error) {
        if (
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
      const after = await snapshot(meetingIds, db);
      if (digest(before) !== digest(after)) {
        const stale = await db.meeting_answers.create({
          data: {
            conversationId: conversation.id,
            question,
            status: "FAILED_STALE",
            text: null,
            missingInfo: null,
            citations: JSON.stringify([]),
            sourceState: JSON.stringify(before),
            previousAnswerId,
            error:
              "Selected meeting source set or revision changed while generating the answer",
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
        return { stale: true };
      }
      const row = await db.meeting_answers.create({
        data: {
          conversationId: conversation.id,
          question,
          status: result.status,
          text: result.text,
          missingInfo: result.missingInfo,
          citations: JSON.stringify(result.citations),
          sourceState: JSON.stringify(before),
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
        "Selected meeting source set or revision changed while generating the answer",
        "MEETING_SOURCE_CHANGED",
        409
      );
    const row = publication.row;
    return {
      ...row,
      citations: result.citations,
      sourceState: before,
      stale: false,
      newSources: false,
    };
  }

  return { createConversation, getConversation, ask, history };
}

module.exports = { createQAService };
