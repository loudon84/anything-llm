const { MeetingError } = require("../../modules/meetings/errors");

const AUTH_REQUIRED = "MGW_BUSINESS_AUTH_REQUIRED";
const RESOURCE_DENIED = "MGW_RESOURCE_NOT_ACCESSIBLE";
const REMOTE_DENIED = "MGW_REMOTE_ACCESS_REQUIRED";

function createMeetingAuthAccess({
  meetingStore,
  workspaceAccess = async () => true,
  clock = () => new Date(),
} = {}) {
  function deny(code, message, status = 403) {
    throw new MeetingError(message, code, status);
  }

  function assertKnownAuth(authState) {
    if (!authState?.authenticated || !["GATEWAY_SESSION", "LEGACY_MULTI_USER", "LEGACY_SINGLE_USER"].includes(authState.kind))
      deny(AUTH_REQUIRED, "A valid local meeting session is required", 401);
  }

  function assertGatewaySession(authState) {
    assertKnownAuth(authState);
    if (authState.kind !== "GATEWAY_SESSION") return false;
    const actorId = Number(authState.actor?.userId ?? authState.actor?.id);
    const session = authState.session;
    if (
      !Number.isSafeInteger(actorId) || actorId <= 0 ||
      !session?.id || Number(session.userId) !== actorId ||
      !Number.isFinite(Date.parse(session.expiresAt)) ||
      Date.parse(session.expiresAt) <= clock().getTime() ||
      !["GATEWAY_ENABLED", "LOCAL_ONLY"].includes(authState.remoteAccessMode ?? session.remoteAccessMode)
    ) deny(AUTH_REQUIRED, "A valid local meeting session is required", 401);
    return true;
  }

  function getRequestState({ response } = {}) {
    const state = response?.locals?.meetingAuthState;
    assertKnownAuth(state);
    if (state.kind === "GATEWAY_SESSION") assertGatewaySession(state);
    return state;
  }

  function assertRemoteAllowed({ authState, action } = {}) {
    assertKnownAuth(authState);
    if (authState.kind === "GATEWAY_SESSION") {
      assertGatewaySession(authState);
      if ((authState.remoteAccessMode ?? authState.session.remoteAccessMode) !== "GATEWAY_ENABLED")
        deny(REMOTE_DENIED, `Remote meeting action is unavailable in local-only mode: ${String(action || "remote")}`);
    }
    return true;
  }

  function getJobAuthContext(authState) {
    assertKnownAuth(authState);
    if (authState.kind === "GATEWAY_SESSION") {
      assertGatewaySession(authState);
      return {
        kind: "GATEWAY_SESSION",
        sessionId: String(authState.session.id),
        userId: Number(authState.actor.userId ?? authState.actor.id),
        credentialEpoch: Number(authState.session.credentialEpoch),
      };
    }
    return {
      kind: authState.kind,
      userId: Number.isSafeInteger(Number(authState.actor?.userId ?? authState.actor?.id))
        ? Number(authState.actor.userId ?? authState.actor.id)
        : null,
    };
  }

  async function assertLocalMeetingReadable({ authState, meetingIds = [], action } = {}) {
    assertKnownAuth(authState);
    const ids = [...new Set((meetingIds || []).map(Number))];
    if (!ids.length) return [];
    const isGateway = assertGatewaySession(authState);
    if (!isGateway) return ids;
    const actorId = Number(authState.actor.userId ?? authState.actor.id);
    if (!meetingStore || typeof meetingStore.findMeetings !== "function")
      deny(RESOURCE_DENIED, "Meeting access could not be verified", 403);
    const rows = await meetingStore.findMeetings(ids);
    if (!Array.isArray(rows) || rows.length !== ids.length)
      deny(RESOURCE_DENIED, `Meeting scope is unavailable for ${String(action || "read")}`, 403);
    for (const row of rows) {
      if (Number(row.createdBy) !== actorId || row.createdBy == null)
        deny(RESOURCE_DENIED, `Meeting scope is unavailable for ${String(action || "read")}`, 403);
      if (row.workspaceId != null && !(await workspaceAccess({
        workspaceId: Number(row.workspaceId), userId: actorId, actor: authState.actor,
      }))) deny(RESOURCE_DENIED, "Meeting workspace is unavailable", 403);
    }
    return ids;
  }

  async function filterLocalMeetings({ authState, meetings = [], action } = {}) {
    assertKnownAuth(authState);
    if (authState.kind !== "GATEWAY_SESSION") return meetings;
    const readable = [];
    for (const meeting of meetings) {
      try {
        await assertLocalMeetingReadable({ authState, meetingIds: [meeting.id], action });
        readable.push(meeting);
      } catch (error) {
        if (error?.code !== RESOURCE_DENIED) throw error;
      }
    }
    return readable;
  }

  return { assertLocalMeetingReadable, assertRemoteAllowed, filterLocalMeetings, getJobAuthContext, getRequestState };
}

module.exports = { createMeetingAuthAccess };
