import test from "node:test";
import assert from "node:assert/strict";
import { createMeetingGatewayClient } from "../src/models/meetingGateway.js";

test("session bootstrap keeps CSRF in memory and sends it only to BFF mutations", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("/session")) {
      return jsonResponse({
        binding_status: "BOUND",
        expires_at: "2030-01-01T00:00:00.000Z",
        csrf_token: "csrf-in-memory",
      });
    }
    return jsonResponse({
      authorization_url: "https://meeting.tencent.com/oauth?state=ephemeral",
      transaction_id: "tx-1",
      expires_at: "2030-01-01T00:01:00.000Z",
    });
  };
  const client = createMeetingGatewayClient({
    fetchImpl,
    getAuthHeaders: () => ({ Authorization: "Bearer anythingllm-session" }),
  });

  await client.startOAuth();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/meeting-gateway/session");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[1].url, "/api/meeting-gateway/oauth/start");
  assert.equal(calls[1].options.headers["X-Meeting-CSRF"], "csrf-in-memory");
  assert.equal(calls[1].options.headers.Authorization, "Bearer anythingllm-session");
  assert.equal(calls[1].options.body, "{}");
});

test("refresh starts without cached CSRF and bootstraps from the BFF", async () => {
  const calls = [];
  const client = createMeetingGatewayClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({
        binding_status: "BOUND",
        expires_at: "2030-01-01T00:00:00.000Z",
        csrf_token: "new-page-csrf",
      });
    },
    getAuthHeaders: () => ({}),
  });

  const session = await client.bootstrapSession();

  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.deepEqual(session, {
    binding_status: "BOUND",
    expires_at: "2030-01-01T00:00:00.000Z",
  });
});

test("connection DTO rejects unexpected credential fields", async () => {
  const client = createMeetingGatewayClient({
    fetchImpl: async () =>
      jsonResponse({
        items: [{ id: "c1", name: "Work", status: "ACTIVE", gateway_token: "secret" }],
      }),
    getAuthHeaders: () => ({}),
  });

  await assert.rejects(client.listConnections(), { message: "MGW_UI_UNAVAILABLE" });
});

test("login rejects an empty CSRF token with the same unavailable state as bootstrap", async () => {
  const client = createMeetingGatewayClient({
    fetchImpl: async () =>
      jsonResponse({
        binding_status: "BOUND",
        expires_at: "2030-01-01T00:00:00.000Z",
        csrf_token: "",
      }),
    getAuthHeaders: () => ({}),
  });

  await assert.rejects(client.login("employee", "password"), {
    message: "MGW_UI_UNAVAILABLE",
  });
});

test("unrecognized BFF errors are reduced to a safe adapter code", async () => {
  const client = createMeetingGatewayClient({
    fetchImpl: async () => jsonResponse({ error: "token=upstream-secret" }, 503),
    getAuthHeaders: () => ({}),
  });

  await assert.rejects(client.listConnections(), {
    message: "MGW_UI_UNAVAILABLE",
  });
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
