const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { isolatedServer, client } = require("../test-support/database");
let f, a, b;
before(async () => { f = await isolatedServer(); a = client(f); b = client(f); for (const [c, name] of [[a, "a"], [b, "b"]]) { await c.bootstrap(); await c.request("/api/auth/register", { method: "POST", body: { name, email: `${name}@profile.test`, password: "Synthetic-password-123" } }); } });
after(async () => f?.close());
const update = (data, extras = {}) => ({ name: data.name, expectedVersion: data.version, healthContext: { medications: null, allergies: null, conditions: null }, consent: { chat: false, reports: false, profile: false, noticeVersion: data.noticeVersion }, ...extras });
test("profiles are owner-scoped and optional fields remain unknown, with explicit notice decisions", async () => {
  const data = (await a.request("/api/account")).data; assert.equal(data.consent.chat, false);
  const body = update(data, { healthContext: { medications: "synthetic medication", allergies: null, conditions: null } }); assert.equal((await a.request("/api/account", { method: "PUT", body })).status, 200);
  assert.equal((await b.request("/api/account")).data.healthContext.medications, null); assert.equal((await a.request("/api/account")).data.healthContext.medications, "synthetic medication");
  assert.equal((await a.request("/api/account", { method: "PUT", body })).status, 409);
});
test("profile mutations reject ownership, invalid decisions and missing CSRF; clearing health context works", async () => {
  const data = (await a.request("/api/account")).data;
  for (const body of [update(data, { ownerId: "other" }), update(data, { healthContext: { medications: "x".repeat(501), allergies: null, conditions: null } }), update(data, { consent: { chat: true, reports: false, profile: false, noticeVersion: "old" } })]) assert.equal((await a.request("/api/account", { method: "PUT", body })).status, 400);
  assert.equal((await a.request("/api/account", { method: "PUT", body: update(data), csrf: false })).status, 403);
  assert.equal((await a.request("/api/account", { method: "PUT", body: update(data) })).status, 200);
  assert.equal((await a.request("/api/account")).data.healthContext.medications, null);
});
test("consent blocks real transfers and withdrawal removes permission without deleting saved records", async () => {
  const { assertConsent } = require("../src/services/consent"), user = await f.User.findOne({ email: "a@profile.test" });
  await assert.rejects(assertConsent(f.connection, user._id, "reports"), (e) => e.code === "CONSENT_REQUIRED");
  const data = (await a.request("/api/account")).data; const body = update(data); body.consent.reports = true;
  await a.request("/api/account", { method: "PUT", body }); await assertConsent(f.connection, user._id, "reports");
  const next = (await a.request("/api/account")).data; await a.request("/api/account", { method: "PUT", body: update(next) }); await assert.rejects(assertConsent(f.connection, user._id, "reports")); assert.ok(await f.User.findById(user._id));
});

test("an older account without persisted settings defaults can save consent once and retains conflict protection", async () => {
  const legacy = client(f);
  await legacy.bootstrap();
  assert.equal((await legacy.request('/api/auth/register', { method: 'POST', body: { name: 'Legacy fixture', email: 'legacy@profile.test', password: 'Synthetic-password-123' } })).status, 201);
  const user = await f.User.findOne({ email: 'legacy@profile.test' });
  await f.User.collection.updateOne({ _id: user._id }, { $unset: { privacyVersion: '', consent: '', healthContext: '', contextFence: '', deletionState: '' } });
  const data = (await legacy.request('/api/account')).data;
  assert.equal(data.version, 0);
  assert.equal(data.consent.chat, false);
  assert.equal(data.consent.reports, false);
  const body = update(data, { consent: { chat: true, reports: true, profile: false, noticeVersion: data.noticeVersion } });
  const results = await Promise.all([
    legacy.request('/api/account', { method: 'PUT', body }),
    legacy.request('/api/account', { method: 'PUT', body }),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const reloaded = (await legacy.request('/api/account')).data;
  assert.equal(reloaded.version, 1);
  assert.equal(reloaded.consent.chat, true);
  assert.equal(reloaded.consent.reports, true);
  const stored = await f.User.collection.findOne({ _id: user._id });
  assert.equal(stored.privacyVersion, 1);
  assert.equal(stored.consent.chat, true);
  assert.equal(stored.consent.reports, true);
  assert.equal((await legacy.request('/api/account', { method: 'PUT', body })).status, 409);
});
