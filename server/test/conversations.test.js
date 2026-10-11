const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { isolatedServer, client } = require("../test-support/database");
const { createDemoReply } = require("../src/services/chat");
const { initializeConversations } = require("../src/models/Conversation");
let fixture, a, b, ownerA;
let generation = () => createDemoReply();
before(async () => {
  fixture = await isolatedServer({ generation: { generateReply: (input) => generation(input), leaseMs: 30000 } });
  a = client(fixture); b = client(fixture);
  for (const [browser, email] of [[a, "history-a@example.com"], [b, "history-b@example.com"]]) {
    await browser.bootstrap();
    const registered = await browser.request("/api/auth/register", { method: "POST", body: { name: "History Tester", email, password: "a synthetic testing passphrase" } });
    assert.equal(registered.status, 201);
    if (browser === a) ownerA = registered.data.user.id;
  }
});
after(async () => { if (fixture) await fixture.close(); });
const base = (id) => `/api/conversations/${id}`;
async function create(browser = a) {
  const result = await browser.request("/api/conversations", { method: "POST", body: {} });
  assert.equal(result.status, 201);
  return result.data.conversation;
}
const send = (id, requestId = randomUUID(), message = "Synthetic hello", browser = a) => browser.request(`${base(id)}/messages`, { method: "POST", body: { requestId, message } });
function gate() {
  let release, entered;
  const ready = new Promise((resolve) => { entered = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  generation = async () => { entered(); await waiting; return createDemoReply(); };
  return { ready, release };
}

test("transaction capability is required rather than silently accepting standalone MongoDB", async () => {
  await assert.rejects(initializeConversations({ db: { admin: () => ({ command: async () => ({}) }) } }), (error) => error.code === "REPLICA_SET_REQUIRED");
});
test("create, save, list, reopen and rename keep persisted IDs and ordered demo replies", async () => {
  const c = await create();
  assert.equal(c.title, "New conversation");
  const result = await send(c.id);
  assert.equal(result.status, 200);
  assert.equal(result.data.status, "completed");
  assert.equal(result.data.conversation.title, "Synthetic hello");
  assert.deepEqual(result.data.messages.map((m) => [m.role, m.sequence]), [["user", 1], ["assistant", 2]]);
  assert.equal(result.data.messages[1].mode, "demo");
  const reopened = await a.request(`${base(c.id)}/messages`);
  assert.deepEqual(reopened.data.messages, result.data.messages);
  assert.equal(reopened.data.activeRequest, null);
  const rename = await a.request(base(c.id), { method: "PATCH", body: { title: "Synthetic saved title" } });
  assert.equal(rename.status, 200);
  const list = await a.request("/api/conversations");
  assert.equal(list.data.conversations[0].id, c.id);
  assert.equal(list.data.conversations[0].title, "Synthetic saved title");
});
test("conversation keyset pagination handles equal timestamps and isolates owners", async () => {
  const ids = [];
  for (let i = 0; i < 5; i++) ids.push((await create(b)).id);
  await fixture.Conversation.collection.updateMany({ ownerId: (await fixture.User.findById((await b.request("/api/auth/me")).data.user.id))._id }, { $set: { updatedAt: new Date("2026-01-01") } });
  let cursor = null; const found = [];
  do {
    const page = await b.request(`/api/conversations?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(page.status, 200); found.push(...page.data.conversations.map((c) => c.id)); cursor = page.data.nextCursor;
  } while (cursor);
  assert.deepEqual(found, [...ids].sort().reverse());
  assert.equal(new Set(found).size, ids.length);
});
test("message pages return oldest-to-newest rows with exclusive stable sequence cursors", async () => {
  const c = await create();
  for (let i = 0; i < 3; i++) assert.equal((await send(c.id, randomUUID(), `Synthetic ${i}`)).status, 200);
  const recent = await a.request(`${base(c.id)}/messages?limit=3`);
  assert.deepEqual(recent.data.messages.map((m) => m.sequence), [4, 5, 6]);
  const older = await a.request(`${base(c.id)}/messages?limit=3&cursor=${recent.data.nextCursor}`);
  assert.deepEqual(older.data.messages.map((m) => m.sequence), [1, 2, 3]);
  assert.equal(older.data.nextCursor, null);
});
test("inaccessible and absent conversations have identical not-found responses for every operation", async () => {
  const c = await create();
  await send(c.id);
  for (const [method, suffix, body] of [["GET", "/messages"], ["POST", "/messages", { requestId: randomUUID(), message: "Synthetic" }], ["PATCH", "", { title: "Synthetic rename" }], ["DELETE", "", {}]]) {
    const inaccessible = await b.request(base(c.id) + suffix, { method, body });
    const absent = await b.request(base("012345678901234567890123") + suffix, { method, body });
    assert.equal(inaccessible.status, 404); assert.deepEqual(inaccessible.data, absent.data);
  }
  assert.equal((await a.request(`${base(c.id)}/messages`)).data.messages.length, 2);
});
test("every conversation route rejects missing sessions; logout invalidates earlier cookies", async () => {
  const c = await create(); const anonymous = client(fixture);
  for (const [method, path] of [["GET", "/api/conversations"], ["POST", "/api/conversations"], ["GET", `${base(c.id)}/messages`], ["POST", `${base(c.id)}/messages`], ["PATCH", base(c.id)], ["DELETE", base(c.id)]]) {
    assert.equal((await anonymous.request(path, { method, body: method === "GET" ? undefined : {} })).status, 401);
  }
  const oldCookie = b.cookie;
  assert.equal((await b.request("/api/auth/logout", { method: "POST", body: {} })).status, 200);
  assert.equal((await b.request("/api/conversations", { savedCookie: oldCookie })).status, 401);
  await b.bootstrap();
  assert.equal((await b.request("/api/auth/login", { method: "POST", body: { email: "history-b@example.com", password: "a synthetic testing passphrase" } })).status, 200);
});
test("all mutations enforce CSRF; old /api/chat has been removed", async () => {
  const c = await create();
  for (const [method, path, body] of [["POST", "/api/conversations", {}], ["POST", `${base(c.id)}/messages`, { requestId: randomUUID(), message: "Synthetic" }], ["PATCH", base(c.id), { title: "Synthetic" }], ["DELETE", base(c.id), {}]]) {
    const result = await a.request(path, { method, body, csrf: false });
    assert.equal(result.status, 403); assert.equal(result.data.error.code, "CSRF_INVALID");
  }
  assert.equal((await a.request("/api/chat", { method: "POST", body: { message: "Synthetic" } })).status, 404);
});
test("invalid IDs, pagination, titles, messages and browser-controlled fields are rejected", async () => {
  const c = await create();
  for (const id of ["bad", "g".repeat(24)]) assert.equal((await a.request(`${base(id)}/messages`)).status, 404);
  for (const query of ["limit=0", "limit=51", "limit=abc", "cursor=bad", "ownerId=other"]) assert.equal((await a.request(`/api/conversations?${query}`)).status, 400);
  for (const query of ["cursor=-1", "cursor=0", "cursor=1.5", "limit=100"]) assert.equal((await a.request(`${base(c.id)}/messages?${query}`)).status, 400);
  for (const body of [{ title: "" }, { title: " " }, { title: 4 }, { title: "x".repeat(81) }, { title: "Synthetic", ownerId: ownerA }]) assert.equal((await a.request(base(c.id), { method: "PATCH", body })).status, 400);
  for (const body of [{ message: " " }, { message: 4 }, { message: "x".repeat(2001) }, { message: "Synthetic", role: "assistant" }, { message: "Synthetic", ownerId: ownerA }, { message: "Synthetic", status: "completed" }, { message: "Synthetic", requestId: "bad" }]) {
    assert.equal((await a.request(`${base(c.id)}/messages`, { method: "POST", body: { requestId: randomUUID(), ...body } })).status, 400);
  }
  assert.equal((await a.request("/api/conversations", { method: "POST", body: { ownerId: ownerA } })).status, 400);
});
test("lost-response retries return the same records and changed content conflicts", async () => {
  const c = await create(), id = randomUUID();
  const initial = await send(c.id, id);
  const retry = await send(c.id, id); // Pretend the initial response never reached the browser.
  assert.equal(retry.status, 200); assert.deepEqual(retry.data, initial.data);
  assert.equal(await fixture.Message.countDocuments({ conversationId: c.id }), 2);
  const changed = await send(c.id, id, "Different synthetic text");
  assert.equal(changed.status, 409); assert.equal(changed.data.error.code, "REQUEST_ID_REUSED");
});
test("simultaneous duplicate requests publish one pair and different requests receive recoverable conflict", async () => {
  const c = await create(), id = randomUUID(), delayed = gate();
  const first = send(c.id, id);
  await delayed.ready;
  try {
    const duplicate = await send(c.id, id);
    assert.equal(duplicate.status, 202); assert.equal(duplicate.data.status, "pending");
    const different = await send(c.id);
    assert.equal(different.status, 409); assert.equal(different.data.error.code, "CONVERSATION_BUSY");
    assert.equal((await send(c.id, id, "Changed synthetic text")).status, 409);
  } finally { generation = () => createDemoReply(); delayed.release(); }
  assert.equal((await first).status, 200);
  const retries = await Promise.all([send(c.id, id), send(c.id, id)]);
  assert.ok(retries.every((r) => r.status === 200));
  assert.equal(await fixture.Message.countDocuments({ conversationId: c.id }), 2);
  assert.equal(await fixture.ChatRequest.countDocuments({ conversationId: c.id }), 1);
});
test("failed generation keeps the user message and permits retry after reopening", async () => {
  const c = await create(), id = randomUUID();
  generation = () => { throw new Error("Synthetic failure"); };
  try { assert.equal((await send(c.id, id)).data.error.code, "REPLY_FAILED"); }
  finally { generation = () => createDemoReply(); }
  const reopened = await a.request(`${base(c.id)}/messages`);
  assert.equal(reopened.data.activeRequest.status, "failed");
  assert.equal(reopened.data.activeRequest.requestId, id);
  assert.equal(reopened.data.messages.length, 1);
  assert.equal((await send(c.id, id)).status, 200);
  assert.equal(await fixture.Message.countDocuments({ conversationId: c.id }), 2);
});
test("requests racing the initial reservation cannot generate or save duplicate replies", async () => {
  const c = await create(), id = randomUUID();
  let calls = 0;
  generation = () => { calls++; return createDemoReply(); };
  try {
    const results = await Promise.all(Array.from({ length: 8 }, () => send(c.id, id)));
    assert.ok(results.every((result) => [200, 202].includes(result.status)));
    assert.equal((await send(c.id, id)).status, 200);
    assert.equal(calls, 1);
    assert.equal(await fixture.Message.countDocuments({ conversationId: c.id }), 2);
    assert.equal(await fixture.ChatRequest.countDocuments({ conversationId: c.id }), 1);
  } finally { generation = () => createDemoReply(); }
});
test("expired processing is reclaimed and the stale worker cannot publish another reply", async () => {
  const c = await create(), id = randomUUID(), delayed = gate();
  const oldWorker = send(c.id, id);
  await delayed.ready;
  try {
    await fixture.ChatRequest.updateOne({ conversationId: c.id, requestId: id }, { $set: { leaseUntil: new Date(0) } });
    const reopened = await a.request(`${base(c.id)}/messages`);
    assert.equal(reopened.data.activeRequest.status, "failed");
    generation = () => createDemoReply();
    assert.equal((await send(c.id, id)).status, 200);
  } finally { generation = () => createDemoReply(); delayed.release(); }
  assert.equal((await oldWorker).status, 200);
  assert.equal(await fixture.Message.countDocuments({ conversationId: c.id }), 2);
  assert.equal((await fixture.ChatRequest.findOne({ conversationId: c.id })).attempts, 2);
});
test("deleting during processing removes all records and prevents late resurrection", async () => {
  const c = await create(), id = randomUUID(), delayed = gate();
  const processing = send(c.id, id);
  await delayed.ready;
  try { assert.equal((await a.request(base(c.id), { method: "DELETE", body: {} })).status, 200); }
  finally { generation = () => createDemoReply(); delayed.release(); }
  assert.equal((await processing).status, 404);
  assert.equal(await fixture.Conversation.countDocuments({ _id: c.id }), 0);
  assert.equal(await fixture.Message.countDocuments({ conversationId: c.id }), 0);
  assert.equal(await fixture.ChatRequest.countDocuments({ conversationId: c.id }), 0);
  assert.equal((await send(c.id, id)).status, 404);
});
test("completed conversation deletion removes messages and jobs without touching other conversations", async () => {
  const c = await create(), other = await create();
  await send(c.id); await send(other.id);
  assert.equal((await a.request(base(c.id), { method: "DELETE", body: {} })).status, 200);
  assert.equal(await fixture.Message.countDocuments({ conversationId: c.id }), 0);
  assert.equal(await fixture.ChatRequest.countDocuments({ conversationId: c.id }), 0);
  assert.equal(await fixture.Message.countDocuments({ conversationId: other.id }), 2);
});
test("conversation indexes enforce request and sequence uniqueness", async () => {
  const messages = await fixture.Message.collection.indexes(), requests = await fixture.ChatRequest.collection.indexes();
  assert.ok(messages.some((index) => index.unique && index.key.sequence === 1));
  assert.ok(messages.some((index) => index.unique && index.key.requestId === 1 && index.key.role === 1));
  assert.ok(requests.some((index) => index.unique && index.key.conversationId === 1 && index.key.requestId === 1));
});
test("database unavailability returns safe 503 on history endpoints", async () => {
  await fixture.mongo.stop();
  for (const path of ["/api/conversations", "/api/conversations/012345678901234567890123/messages"]) {
    const result = await a.request(path);
    assert.equal(result.status, 503); assert.equal(result.data.error.code, "SERVICE_UNAVAILABLE");
    assert.ok(!JSON.stringify(result.data).includes("mongodb"));
  }
});
