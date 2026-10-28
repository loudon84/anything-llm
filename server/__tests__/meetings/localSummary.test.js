const {
  createLocalSummaryService,
  LOCAL_SUMMARY_ORIGIN,
  LOCAL_SUMMARY_TYPE,
} = require("../../modules/meetings/localSummary");
const { createMeetingService } = require("../../modules/meetings/meetingService");
const { MeetingError } = require("../../modules/meetings/errors");

function fakePrisma(seed = {}) {
  const state = {
    meetings: [...(seed.meetings || [])],
    meeting_sources: [...(seed.meeting_sources || [])],
    meeting_chunks: [...(seed.meeting_chunks || [])],
    meeting_jobs: [...(seed.meeting_jobs || [])],
    nextMeetingId: 1,
    nextRowId: 1,
  };
  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === "object" && "in" in value)
        return value.in.includes(row[key]);
      return row[key] === value;
    });
  const delegate = (collection) => ({
    findMany: async ({ where = {} } = {}) =>
      state[collection].filter((row) => matches(row, where)),
    findFirst: async ({ where = {} } = {}) =>
      state[collection].find((row) => matches(row, where)) || null,
    findUnique: async ({ where = {} } = {}) =>
      state[collection].find((row) => matches(row, where)) || null,
    create: async ({ data }) => {
      const row = {
        id:
          collection === "meetings"
            ? state.nextMeetingId++
            : state.nextRowId++,
        ...data,
      };
      state[collection].push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = state[collection].find((candidate) =>
        matches(candidate, where)
      );
      if (!row) throw new Error("record not found");
      Object.assign(row, data);
      return row;
    },
    updateMany: async ({ where = {}, data }) => {
      const rows = state[collection].filter((row) => matches(row, where));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    deleteMany: async ({ where = {} } = {}) => {
      const rows = state[collection].filter((row) => matches(row, where));
      state[collection] = state[collection].filter(
        (row) => !rows.includes(row)
      );
      return { count: rows.length };
    },
  });
  const db = {
    meetings: delegate("meetings"),
    meeting_sources: delegate("meeting_sources"),
    meeting_chunks: delegate("meeting_chunks"),
    meeting_jobs: delegate("meeting_jobs"),
    $transaction: async (callback) => callback(db),
  };
  return { db, state };
}

const metadata = (externalId, overrides = {}) => ({
  connectionId: 1,
  externalId,
  title: `Meeting ${externalId}`,
  startTime: new Date("2026-04-01T02:00:00.000Z"),
  endTime: new Date("2026-04-01T03:00:00.000Z"),
  ...overrides,
});

describe("saveLocalSummary", () => {
  async function draftMeeting(stateExtras = {}) {
    const { db, state } = fakePrisma();
    const meetings = createMeetingService({ prisma: db });
    const meeting = await meetings.createMetadata(metadata("local-summary"), 5);
    Object.assign(meeting, {
      retrievalStatus: "AVAILABLE",
      reviewStatus: "DRAFT",
      generation: 1,
      contentVersion: 0,
      summary: "Meeting table summary must stay put",
      ...stateExtras,
    });
    const service = createLocalSummaryService({ prisma: db });
    return { db, state, meeting, service };
  }

  test("CAS conflict returns CONTENT_VERSION_CONFLICT 409", async () => {
    const { meeting, service } = await draftMeeting({ contentVersion: 2 });
    await expect(
      service.saveLocalSummary({
        meetingId: meeting.id,
        content: "stale client draft",
        expectedContentVersion: 0,
        userId: 5,
      })
    ).rejects.toMatchObject({
      code: "CONTENT_VERSION_CONFLICT",
      status: 409,
    });
  });

  test("gateway SUMMARY contentText and originKey stay unchanged after local save", async () => {
    const { state, meeting, service } = await draftMeeting();
    state.meeting_sources.push({
      id: 77,
      meetingId: meeting.id,
      sourceType: "SUMMARY",
      originKey: "gateway:rf1:meeting_summary:0",
      contentText: "Imported gateway summary",
      contentHash: "gateway-hash",
      activeHash: "GATEWAY:gateway:rf1:meeting_summary:0",
      deletedAt: null,
    });

    const { meeting: updated, localSummary } = await service.saveLocalSummary({
      meetingId: meeting.id,
      content: "Locally maintained summary",
      expectedContentVersion: 0,
      userId: 5,
    });

    const gatewayRow = state.meeting_sources.find((row) => row.id === 77);
    expect(gatewayRow).toMatchObject({
      sourceType: "SUMMARY",
      originKey: "gateway:rf1:meeting_summary:0",
      contentText: "Imported gateway summary",
      contentHash: "gateway-hash",
    });
    expect(localSummary).toMatchObject({
      sourceType: LOCAL_SUMMARY_TYPE,
      originKey: LOCAL_SUMMARY_ORIGIN,
      contentText: "Locally maintained summary",
      deletedAt: null,
    });
    expect(updated.summary).toBe("Meeting table summary must stay put");
    expect(updated.contentVersion).toBe(1);
    expect(updated.reviewStatus).toBe("DRAFT");
  });

  test("LOCAL_SUMMARY is written and REINDEX is enqueued", async () => {
    const { state, meeting, service } = await draftMeeting();
    const { meeting: updated, localSummary } = await service.saveLocalSummary({
      meetingId: meeting.id,
      content: "Decision A\nDecision B",
      expectedContentVersion: 0,
      userId: 5,
    });

    expect(localSummary).toMatchObject({
      meetingId: meeting.id,
      sourceType: LOCAL_SUMMARY_TYPE,
      originKey: LOCAL_SUMMARY_ORIGIN,
      parseStatus: "SUCCESS",
      contentText: "Decision A\nDecision B",
    });
    expect(JSON.parse(localSummary.segments)).toEqual([
      { text: "Decision A", location: { type: "paragraph", paragraph: 0 } },
      { text: "Decision B", location: { type: "paragraph", paragraph: 1 } },
    ]);
    expect(updated).toMatchObject({
      contentVersion: 1,
      generation: 2,
      retrievalStatus: "INDEXING",
      summary: "Meeting table summary must stay put",
    });
    expect(state.meeting_jobs).toHaveLength(1);
    expect(state.meeting_jobs[0]).toMatchObject({
      kind: "REINDEX",
      meetingId: meeting.id,
      status: "CREATED",
      activeKey: `REINDEX:${meeting.id}:2`,
    });
  });

  test("APPROVED meetings reject with MEETING_IMMUTABLE", async () => {
    const { meeting, service } = await draftMeeting({
      reviewStatus: "APPROVED",
    });
    await expect(
      service.saveLocalSummary({
        meetingId: meeting.id,
        content: "Should not apply",
        expectedContentVersion: 0,
        userId: 5,
      })
    ).rejects.toMatchObject({
      code: "MEETING_IMMUTABLE",
      status: 409,
    });
    expect(MeetingError).toBeTruthy();
  });

  test("empty content soft-deletes LOCAL_SUMMARY without touching gateway SUMMARY", async () => {
    const { state, meeting, service } = await draftMeeting({ contentVersion: 1 });
    state.meeting_sources.push(
      {
        id: 77,
        meetingId: meeting.id,
        sourceType: "SUMMARY",
        originKey: "gateway:rf1:meeting_summary:0",
        contentText: "Imported gateway summary",
        deletedAt: null,
      },
      {
        id: 78,
        meetingId: meeting.id,
        sourceType: LOCAL_SUMMARY_TYPE,
        originKey: LOCAL_SUMMARY_ORIGIN,
        contentText: "Prior local draft",
        activeHash: "LOCAL_SUMMARY:abc",
        deletedAt: null,
      }
    );

    const { localSummary } = await service.saveLocalSummary({
      meetingId: meeting.id,
      content: "   \n  ",
      expectedContentVersion: 1,
      userId: 5,
    });

    expect(localSummary).toMatchObject({
      id: 78,
      activeHash: null,
      contentText: null,
    });
    expect(localSummary.deletedAt).toBeTruthy();
    expect(state.meeting_sources.find((row) => row.id === 77).contentText).toBe(
      "Imported gateway summary"
    );
    expect(state.meeting_jobs[0].kind).toBe("REINDEX");
  });
});
