import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { api, clearCsrf } from "../src/api/client.js";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; clearCsrf(); });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

test("mutations fetch a CSRF token, send cookie credentials and retain rotated tokens in memory", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url === "/api/auth/csrf") return json({ csrfToken: "initial-token" });
    if (url === "/api/auth/login") return json({ user: { id: "one" }, csrfToken: "rotated-token" });
    return json({ mode: "demo", reply: "test" });
  };
  await api("/auth/login", { method: "POST", body: { email: "demo@example.com", password: "a testing passphrase" } });
  await api("/conversations/012345678901234567890123/messages", { method: "POST", body: { message: "Hello" } });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].options.headers["x-csrf-token"], "initial-token");
  assert.equal(calls[2].options.headers["x-csrf-token"], "rotated-token");
  assert.equal(calls[2].options.credentials, "same-origin");
  assert.deepEqual(JSON.parse(calls[2].options.body), { message: "Hello" });
});

test("explicit CSRF rejection renews a token and retries the rejected operation only once", async () => {
  let tokens = 0, writes = 0;
  globalThis.fetch = async (url) => {
    if (url === "/api/auth/csrf") return json({ csrfToken: `token-${++tokens}` });
    writes++;
    return writes === 1 ? json({ error: { code: "CSRF_INVALID", message: "Expired token" } }, 403) : json({ mode: "demo", reply: "test" });
  };
  await api("/conversations/012345678901234567890123/messages", { method: "POST", body: { message: "Hello" } });
  assert.equal(tokens, 2); assert.equal(writes, 2);
});

test("network failure does not automatically resubmit an uncertain mutation", async () => {
  let writes = 0;
  globalThis.fetch = async (url) => {
    if (url === "/api/auth/csrf") return json({ csrfToken: "token" });
    writes++; throw new TypeError("network failure");
  };
  await assert.rejects(api("/auth/register", { method: "POST", body: {} }), (error) => error.status === 0 && /Could not reach/.test(error.message));
  assert.equal(writes, 1);
});

test("session expiry and database outage remain distinguishable", async () => {
  globalThis.fetch = async () => json({ error: { code: "UNAUTHENTICATED", message: "Sign in" } }, 401);
  await assert.rejects(api("/auth/me"), (error) => error.status === 401 && error.code === "UNAUTHENTICATED");
  globalThis.fetch = async () => json({ error: { code: "SERVICE_UNAVAILABLE", message: "Try later" } }, 503);
  await assert.rejects(api("/auth/me"), (error) => error.status === 503 && error.code === "SERVICE_UNAVAILABLE");
});

test("concurrent mutations share one CSRF bootstrap", async () => {
  let tokens = 0;
  globalThis.fetch = async (url) => {
    if (url === "/api/auth/csrf") { tokens++; return json({ csrfToken: "token" }); }
    return json({ mode: "demo", reply: "test" });
  };
  await Promise.all([api("/conversations/012345678901234567890123/messages", { method: "POST" }), api("/conversations/012345678901234567890123/messages", { method: "POST" })]);
  assert.equal(tokens, 1);
});

test("account changes cancel mutations still waiting for an old CSRF bootstrap", async () => {
  let release;
  let writes = 0;
  globalThis.fetch = async (url) => {
    if (url === "/api/auth/csrf") return new Promise((resolve) => { release = () => resolve(json({ csrfToken: "old-account-token" })); });
    writes++; return json({});
  };
  const request = api("/conversations", { method: "POST" });
  clearCsrf();
  release();
  await assert.rejects(request, (error) => error.name === "AbortError");
  assert.equal(writes, 0);
});

test("CSRF retries preserve a conversation submission's intended request ID", async () => {
  const bodies = [];
  globalThis.fetch = async (url, options) => {
    if (url === "/api/auth/csrf") return json({ csrfToken: "token" });
    bodies.push(JSON.parse(options.body));
    return bodies.length === 1 ? json({ error: { code: "CSRF_INVALID", message: "Expired" } }, 403) : json({ status: "completed" });
  };
  const submission = { message: "Synthetic", requestId: "045a0785-8649-44dd-a28e-18ed6186aba1" };
  await api("/conversations/012345678901234567890123/messages", { method: "POST", body: submission });
  assert.deepEqual(bodies, [submission, submission]);
});
