import test from "node:test";
import assert from "node:assert/strict";
import { buildBaseHeaders } from "../src/utils/baseHeaders.js";

test("base request headers omit Authorization when no local token exists", () => {
  const headers = buildBaseHeaders(null, "Asia/Shanghai", "zh-CN");

  assert.equal(Object.hasOwn(headers, "Authorization"), false);
  assert.equal(headers["X-Timezone"], "Asia/Shanghai");
  assert.equal(headers["X-Language"], "zh-CN");
});

test("base request headers forward a present token unchanged", () => {
  const token = "opaque-invalid-or-expired-token";
  const headers = buildBaseHeaders(token, "UTC", "en-US");

  assert.equal(headers.Authorization, `Bearer ${token}`);
});
