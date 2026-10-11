const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { isolatedServer, client } = require("../test-support/database");
const { readConfig } = require("../src/config");
const { createApp } = require("../src/app");
const password = "a useful testing passphrase";
let fixture;
let sequence = 0;
const account = () => ({ name: "Test User", email: `user${++sequence}@example.com`, password });
async function signedIn() {
  const browser = client(fixture);
  await browser.bootstrap();
  const input = account();
  const result = await browser.request("/api/auth/register", { method: "POST", body: input });
  assert.equal(result.status, 201);
  const conversation = await browser.request("/api/conversations", { method: "POST", body: {} });
  browser.chatPath = `/api/conversations/${conversation.data.conversation.id}/messages`;
  return { browser, input, result };
}
before(async () => { fixture = await isolatedServer(); });
after(async () => { if (fixture) await fixture.close(); });

test("startup rejects missing and weak environment configuration without leaking values", () => {
  assert.throws(() => readConfig({}), /MONGODB_URI/);
  assert.throws(() => readConfig({ MONGODB_URI: "mongodb://localhost/test", SESSION_SECRET: "weak" }), /SESSION_SECRET/);
  assert.throws(() => readConfig({ MONGODB_URI: "mongodb://localhost/test", SESSION_SECRET: "f".repeat(64), APP_ORIGIN: "http://localhost:5173", NODE_ENV: "production" }), /HTTPS/);
});
test("health and readiness work without creating anonymous sessions", async () => {
  const browser = client(fixture);
  assert.equal((await browser.request("/api/health")).status, 200);
  assert.equal((await browser.request("/api/ready")).status, 200);
  assert.equal((await browser.request("/api/auth/me")).status, 401);
  assert.equal(browser.cookie, "");
});

test("startup reports an occupied port and exits without a client-close crash", async () => {
  const { spawn } = require("node:child_process");
  const path = require("node:path");
  const child = spawn(process.execPath, [path.join(__dirname, "../src/index.js")], {
    env: { ...process.env, NODE_ENV: "test", MONGODB_URI: fixture.config.mongoUri,
      SESSION_SECRET: fixture.config.sessionSecret, APP_ORIGIN: fixture.config.origin,
      PORT: new URL(fixture.base).port, TRUST_PROXY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (data) => { output += data; });
  child.stderr.on("data", (data) => { output += data; });
  const timeout = setTimeout(() => child.kill(), 15000);
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("exit", resolve);
      child.once("error", reject);
    });
    assert.equal(code, 1);
    assert.match(output, /already in use/);
    assert.doesNotMatch(output, /Server running|MongoClientClosedError|triggerUncaughtException/);
    assert.ok(!output.includes(fixture.config.mongoUri));
    assert.ok(!output.includes(fixture.config.sessionSecret));
  } finally { clearTimeout(timeout); }
});
test("registration normalizes email, hashes password, regenerates SID and exposes only public fields", async () => {
  const browser = client(fixture);
  await browser.bootstrap();
  const oldCookie = browser.cookie;
  const oldToken = browser.token;
  const input = account();
  const result = await browser.request("/api/auth/register", { method: "POST", body: { ...input, name: "  Test User  ", email: `  ${input.email.toUpperCase()}  ` } });
  assert.equal(result.status, 201);
  assert.equal(result.data.user.email, input.email);
  assert.equal(result.data.user.name, "Test User");
  assert.notEqual(browser.cookie, oldCookie);
  assert.notEqual(browser.token, oldToken);
  assert.match(result.setCookie, /HttpOnly/);
  assert.match(result.setCookie, /SameSite=Lax/);
  assert.ok(!JSON.stringify(result.data).includes("passwordHash"));
  const user = await fixture.User.findById(result.data.user.id).select("+passwordHash");
  assert.match(user.passwordHash, /^\$argon2id\$v=19\$/);
  assert.deepEqual(Object.fromEntries(user.passwordHash.split("$")[3].split(",").map((setting) => setting.split("="))), { m: "19456", t: "2", p: "1" });
  assert.notEqual(user.passwordHash, password);
  assert.equal((await fixture.User.findById(user._id).lean()).passwordHash, undefined);
  assert.ok(!JSON.stringify(user.toJSON()).includes("passwordHash"));
  assert.equal((await browser.request("/api/auth/me", { savedCookie: oldCookie })).status, 401);
});
test("duplicate email and concurrent duplicate registration return structured 409", async () => {
  const input = account();
  const first = client(fixture), second = client(fixture);
  await first.bootstrap(); await second.bootstrap();
  const results = await Promise.all([first.request("/api/auth/register", { method: "POST", body: input }), second.request("/api/auth/register", { method: "POST", body: { ...input, email: input.email.toUpperCase() } })]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal(results.find((result) => result.status === 409).data.error.code, "EMAIL_IN_USE");
});
for (const [label, changes] of [
  ["invalid email", { email: "broken" }], ["wrong email type", { email: {} }],
  ["short password", { password: "short" }], ["overlong password", { password: "x".repeat(129) }],
  ["wrong password type", { password: 12345 }], ["blank name", { name: "   " }],
  ["overlong name", { name: "x".repeat(81) }], ["unallowed role", { role: "admin" }],
]) {
  test(`registration rejects ${label}`, async () => {
    const browser = client(fixture); await browser.bootstrap();
    const result = await browser.request("/api/auth/register", { method: "POST", body: { ...account(), ...changes } });
    assert.equal(result.status, 400);
    assert.equal(result.data.error.code, "INVALID_INPUT");
  });
}
test("login, session restoration, matching expiry and logout invalidation", async () => {
  const { browser, input } = await signedIn();
  const registeredCookie = browser.cookie;
  assert.equal((await browser.request("/api/auth/logout", { method: "POST", body: {} })).status, 200);
  await browser.bootstrap();
  const anonymousCookie = browser.cookie;
  const login = await browser.request("/api/auth/login", { method: "POST", body: { email: input.email, password } });
  assert.equal(login.status, 200);
  assert.notEqual(browser.cookie, anonymousCookie);
  assert.ok(!JSON.stringify(login.data).includes("passwordHash"));
  const restored = await browser.request("/api/auth/me");
  assert.equal(restored.status, 200);
  assert.equal(restored.data.user.id, login.data.user.id);
  assert.equal((await browser.request("/api/auth/me", { savedCookie: registeredCookie })).status, 401);
  const record = await fixture.connection.db.collection("sessions").findOne({ "session": { $regex: login.data.user.id } });
  assert.ok(record);
  const stored = JSON.parse(record.session);
  assert.ok(Math.abs(record.expires.getTime() - stored.authExpiresAt) < 1000);
  assert.ok(Math.abs(stored.authExpiresAt - Date.now() - fixture.config.sessionTtlMs) < 10000);
  const cookieBeforeLogout = browser.cookie;
  const logout = await browser.request("/api/auth/logout", { method: "POST", body: {} });
  assert.equal(logout.status, 200);
  assert.match(logout.setCookie, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await browser.request("/api/auth/me", { savedCookie: cookieBeforeLogout })).status, 401);
});
test("wrong password and missing account have the same generic login error", async () => {
  const { browser, input } = await signedIn();
  const wrong = await browser.request("/api/auth/login", { method: "POST", body: { email: input.email, password: "a wrong testing passphrase" } });
  const absent = await browser.request("/api/auth/login", { method: "POST", body: { email: "absent@example.com", password } });
  assert.equal(wrong.status, 401); assert.equal(absent.status, 401);
  assert.deepEqual(wrong.data, absent.data);
});
test("unauthenticated conversation creation returns 401", async () => {
  const result = await client(fixture).request("/api/conversations", { method: "POST", body: {} });
  assert.equal(result.status, 401); assert.equal(result.data.error.code, "UNAUTHENTICATED");
});
test("authenticated demo chat and 2000-character boundary succeed", async () => {
  const { browser } = await signedIn();
  for (const message of ["Hello", "x".repeat(2000)]) {
    const result = await browser.request(browser.chatPath, { method: "POST", body: { message, requestId: randomUUID() } });
    assert.equal(result.status, 200); assert.equal(result.data.messages[1].mode, "demo");
    assert.match(result.data.messages[1].content, /no medical analysis/);
  }
});
test("blank, wrong-type, over-limit chat and browser identity fields are rejected", async () => {
  const { browser } = await signedIn();
  for (const body of [{ message: "" }, { message: "   " }, { message: 1 }, { message: {} }, { message: "x".repeat(2001) }, {}, { message: "Hi", userId: "someone-else" }]) {
    assert.equal((await browser.request(browser.chatPath, { method: "POST", body: { requestId: randomUUID(), ...body } })).status, 400);
  }
});
test("CSRF is required on register, login, logout and authenticated chat", async () => {
  const { browser } = await signedIn();
  for (const path of ["/api/auth/register", "/api/auth/login", "/api/auth/logout", browser.chatPath]) {
    const result = await browser.request(path, { method: "POST", body: {}, csrf: false });
    assert.equal(result.status, 403); assert.equal(result.data.error.code, "CSRF_INVALID");
  }
  assert.equal((await browser.request("/api/auth/me")).status, 200);
});
test("cross-origin writes are rejected even with a valid token", async () => {
  const { browser } = await signedIn();
  assert.equal((await browser.request(browser.chatPath, { method: "POST", body: { message: "Hello", requestId: randomUUID() }, origin: "https://untrusted.example" })).status, 403);
});
test("a token from the pre-login session is rejected after ID rotation", async () => {
  const browser = client(fixture); await browser.bootstrap();
  const oldToken = browser.token;
  await browser.request("/api/auth/register", { method: "POST", body: account() });
  const rejected = await browser.request("/api/conversations", { method: "POST", body: {}, csrf: oldToken });
  assert.equal(rejected.status, 403);
  assert.equal((await browser.request("/api/conversations", { method: "POST", body: {} })).status, 201);
});
test("an authenticated session past its absolute deadline is invalidated", async () => {
  const { browser, result } = await signedIn();
  const collection = fixture.connection.db.collection("sessions");
  const record = await collection.findOne({ session: { $regex: result.data.user.id } });
  const stored = JSON.parse(record.session);
  stored.authExpiresAt = Date.now() - 1000;
  await collection.updateOne({ _id: record._id }, { $set: { session: JSON.stringify(stored) } });
  assert.equal((await browser.request("/api/auth/me")).status, 401);
  assert.equal(await collection.countDocuments({ _id: record._id }), 0);
});
test("malformed JSON and oversized bodies keep structured errors", async () => {
  const { browser } = await signedIn();
  const bad = await browser.request(browser.chatPath, { method: "POST", raw: "{broken" });
  assert.equal(bad.status, 400); assert.equal(bad.data.error.code, "INVALID_JSON");
  const huge = await browser.request(browser.chatPath, { method: "POST", body: { message: "x".repeat(110000) } });
  assert.equal(huge.status, 413); assert.equal(huge.data.error.code, "BODY_TOO_LARGE");
});
test("unique email database index exists", async () => {
  const indexes = await fixture.User.collection.indexes();
  assert.ok(indexes.some((index) => index.key.email === 1 && index.unique));
});
test("production cookies are Secure, HttpOnly and host-only behind the explicitly trusted loopback proxy", async () => {
  const config = { ...fixture.config, production: true, origin: "https://example.test", cookieName: "__Host-fyp.sid", trustProxy: "loopback" };
  const app = createApp({ config, connection: fixture.connection, store: fixture.store });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/auth/csrf`, { headers: { "X-Forwarded-Proto": "https" } });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.ok(cookie.startsWith("__Host-fyp.sid="));
    assert.ok(cookie.includes("; Secure"));
    assert.ok(cookie.includes("; HttpOnly"));
    assert.ok(cookie.includes("; SameSite=Lax"));
    assert.ok(cookie.includes("; Path=/"));
    assert.ok(!cookie.includes("Domain="));
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
test("unknown routes return JSON", async () => {
  const result = await client(fixture).request("/missing");
  assert.equal(result.status, 404); assert.equal(result.data.error.code, "NOT_FOUND");
});
test("login, registration and chat rate limits return 429", async () => {
  const limited = await isolatedServer({ limits: { login: 1, register: 1, chat: 1, csrf: 20 } });
  try {
    const browser = client(limited); await browser.bootstrap();
    const input = account();
    assert.equal((await browser.request("/api/auth/register", { method: "POST", body: input })).status, 201);
    assert.equal((await browser.request("/api/auth/register", { method: "POST", body: account() })).status, 429);
    const created = await browser.request("/api/conversations", { method: "POST", body: {} });
    const path = `/api/conversations/${created.data.conversation.id}/messages`;
    assert.equal((await browser.request(path, { method: "POST", body: { message: "Hello", requestId: randomUUID() } })).status, 200);
    assert.equal((await browser.request(path, { method: "POST", body: { message: "Hello", requestId: randomUUID() } })).status, 429);
    assert.equal((await browser.request("/api/auth/login", { method: "POST", body: { email: input.email, password: "wrong testing passphrase" } })).status, 401);
    assert.equal((await browser.request("/api/auth/login", { method: "POST", body: { email: input.email, password } })).status, 429);
  } finally { await limited.close(); }
});
test("database outage yields 503 while liveness stays 200 (last test stops its owned MongoDB)", async () => {
  await fixture.mongo.stop();
  const browser = client(fixture);
  assert.equal((await browser.request("/api/health")).status, 200);
  assert.equal((await browser.request("/api/ready")).status, 503);
  const me = await browser.request("/api/auth/me");
  assert.equal(me.status, 503); assert.equal(me.data.error.code, "SERVICE_UNAVAILABLE");
  assert.ok(!JSON.stringify(me.data).includes("mongodb"));
});
