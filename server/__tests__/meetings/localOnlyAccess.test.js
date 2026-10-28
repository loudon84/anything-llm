const { createMeetingAuthAccess } = require("../../utils/meetingGateway/meetingAuthAccess");
const { createMeetingService } = require("../../modules/meetings/meetingService");

const gatewayState = (userId, remoteAccessMode = "LOCAL_ONLY") => ({
  authenticated: true,
  kind: "GATEWAY_SESSION",
  actor: { id: userId, userId },
  session: {
    id: `session-${userId}`,
    userId,
    credentialEpoch: 3,
    expiresAt: "2026-11-01T00:00:00.000Z",
    remoteAccessMode,
  },
  remoteAccessMode,
});

describe("meeting auth admission", () => {
  test("LOCAL_ONLY permits persisted meeting data for its verified owner only", async () => {
    const access = createMeetingAuthAccess({
      clock: () => new Date("2026-10-20T00:00:00.000Z"),
      meetingStore: {
        findMeetings: async (ids) => [
          { id: 1, createdBy: 11, workspaceId: null },
          { id: 2, createdBy: 22, workspaceId: null },
          { id: 3, createdBy: null, workspaceId: null },
        ].filter((row) => ids.includes(row.id)),
      },
      workspaceAccess: async () => true,
    });

    await expect(
      access.assertLocalMeetingReadable({
        authState: gatewayState(11),
        meetingIds: [1],
        action: "qa.ask",
      })
    ).resolves.toEqual([1]);
    await expect(
      access.assertLocalMeetingReadable({
        authState: gatewayState(22),
        meetingIds: [1],
        action: "qa.ask",
      })
    ).rejects.toMatchObject({ code: "MGW_RESOURCE_NOT_ACCESSIBLE", status: 403 });
    await expect(
      access.assertLocalMeetingReadable({
        authState: gatewayState(11),
        meetingIds: [1, 2],
        action: "qa.ask",
      })
    ).rejects.toMatchObject({ code: "MGW_RESOURCE_NOT_ACCESSIBLE" });
    await expect(
      access.assertLocalMeetingReadable({
        authState: gatewayState(11),
        meetingIds: [3],
        action: "qa.ask",
      })
    ).rejects.toMatchObject({ code: "MGW_RESOURCE_NOT_ACCESSIBLE" });
  });

  test("unknown identity and invalid sessions fail closed while legacy stays explicit", async () => {
    const access = createMeetingAuthAccess({
      clock: () => new Date("2026-10-20T00:00:00.000Z"),
      meetingStore: {
        findMeetings: async (ids) => ids.map((id) => ({ id, createdBy: null })),
      },
      workspaceAccess: async () => true,
    });

    for (const authState of [
      null,
      { authenticated: false, kind: "UNAUTHENTICATED" },
      { authenticated: true, kind: "UNKNOWN", actor: null },
      { ...gatewayState(11), session: { ...gatewayState(11).session, expiresAt: "2026-10-19T00:00:00.000Z" } },
    ]) {
      await expect(
        access.assertLocalMeetingReadable({ authState, meetingIds: [1] })
      ).rejects.toMatchObject({ status: 401 });
    }

    await expect(
      access.assertLocalMeetingReadable({
        authState: { authenticated: true, kind: "LEGACY_SINGLE_USER", actor: null },
        meetingIds: [1],
      })
    ).resolves.toEqual([1]);
  });

  test("LOCAL_ONLY rejects every remote-capable action before its adapter runs", () => {
    const access = createMeetingAuthAccess({});
    for (const action of ["remote.list", "remote.manifest", "import", "retry", "job.dispatch"]) {
      expect(() => access.assertRemoteAllowed({ authState: gatewayState(11), action }))
        .toThrow(expect.objectContaining({ code: "MGW_REMOTE_ACCESS_REQUIRED", status: 403 }));
    }
  });

  test("meeting service filters lists and rejects cross-owner detail reads", async () => {
    const meetings = [
      { id: 1, createdBy: 11, deletedAt: null, retrievalStatus: "AVAILABLE" },
      { id: 2, createdBy: 22, deletedAt: null, retrievalStatus: "AVAILABLE" },
      { id: 3, createdBy: null, deletedAt: null, retrievalStatus: "AVAILABLE" },
    ];
    const meetingAuthAccess = createMeetingAuthAccess({
      meetingStore: { findMeetings: async (ids) => meetings.filter((row) => ids.includes(row.id)) },
    });
    const service = createMeetingService({
      prisma: {
        meetings: {
          findMany: async () => meetings,
          findUnique: async ({ where }) => meetings.find((row) => row.id === where.id) || null,
        },
      },
      meetingAuthAccess,
    });

    await expect(service.list({}, gatewayState(11))).resolves.toEqual([meetings[0]]);
    await expect(service.get(2, gatewayState(11)))
      .rejects.toMatchObject({ code: "MGW_RESOURCE_NOT_ACCESSIBLE", status: 403 });
  });

  test("GATEWAY non-creator with valid session can write a DRAFT meeting", async () => {
    const meetings = [
      { id: 10, createdBy: 11, deletedAt: null, reviewStatus: "DRAFT", workspaceId: null },
      { id: 11, createdBy: 11, deletedAt: null, reviewStatus: "APPROVED", workspaceId: null },
    ];
    const access = createMeetingAuthAccess({
      clock: () => new Date("2026-10-20T00:00:00.000Z"),
      meetingStore: {
        findMeeting: async (id) => meetings.find((row) => row.id === Number(id)) || null,
        findMeetings: async (ids) => meetings.filter((row) => ids.includes(row.id)),
      },
      workspaceAccess: async () => true,
    });

    await expect(
      access.assertMeetingWritable({
        authState: gatewayState(22),
        meetingId: 10,
        action: "meeting.revise",
      })
    ).resolves.toMatchObject({ id: 10, reviewStatus: "DRAFT" });

    await expect(
      access.assertLocalMeetingReadable({
        authState: gatewayState(22),
        meetingIds: [10],
        action: "meeting.read",
      })
    ).rejects.toMatchObject({ code: "MGW_RESOURCE_NOT_ACCESSIBLE", status: 403 });

    await expect(
      access.assertMeetingWritable({
        authState: gatewayState(22),
        meetingId: 11,
        action: "meeting.revise",
      })
    ).rejects.toMatchObject({ code: "MEETING_IMMUTABLE", status: 409 });
  });

  test("LEGACY authenticated actor can write a DRAFT meeting regardless of creator", async () => {
    const meetings = [
      { id: 5, createdBy: 99, deletedAt: null, reviewStatus: "DRAFT", workspaceId: null },
    ];
    const access = createMeetingAuthAccess({
      meetingStore: {
        findMeeting: async (id) => meetings.find((row) => row.id === Number(id)) || null,
        findMeetings: async (ids) => meetings.filter((row) => ids.includes(row.id)),
      },
    });

    await expect(
      access.assertMeetingWritable({
        authState: {
          authenticated: true,
          kind: "LEGACY_MULTI_USER",
          actor: { id: 7, userId: 7 },
        },
        meetingId: 5,
        action: "meeting.revise",
      })
    ).resolves.toMatchObject({ id: 5 });
  });
});
