import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { reportsApi } from "../src/api/reports.js";
import { clearCsrf, reportFile } from "../src/api/client.js";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; clearCsrf(); });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
test("multipart uploads keep the browser boundary, CSRF header, cookies and retry UUID", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    if (url === "/api/auth/csrf") return json({ csrfToken: "test-token" });
    calls.push(options);
    return calls.length === 1 ? json({ error: { code: "CSRF_INVALID", message: "Expired" } }, 403) : json({ report: { id: "synthetic" } });
  };
  const file = new File(["synthetic"], "synthetic.png", { type: "image/png" });
  await reportsApi.upload(file, "dd5e2b62-6ff4-407c-85a0-a577d22d36ec");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers["Content-Type"], undefined);
  assert.equal(calls[0].credentials, "same-origin");
  assert.equal(calls[0].headers["x-csrf-token"], "test-token");
  assert.equal(calls[0].headers["x-upload-id"], calls[1].headers["x-upload-id"]);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].body.get("file").name, "synthetic.png");
});
test("private preview rejects unexpected types and distinguishes expired sessions", async () => {
  const controller = new AbortController();
  globalThis.fetch = async () => new Response("<html>untrusted</html>", { headers: { "Content-Type": "text/html" } });
  await assert.rejects(reportFile("synthetic", controller.signal), /cannot be previewed/);
  globalThis.fetch = async () => json({ error: { code: "UNAUTHENTICATED", message: "Sign in" } }, 401);
  await assert.rejects(reportFile("synthetic", controller.signal), (error) => error.status === 401);
});
