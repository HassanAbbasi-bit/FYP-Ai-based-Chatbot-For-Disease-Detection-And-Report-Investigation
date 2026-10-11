const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { isolatedServer, client } = require("../test-support/database");
const { upload, syntheticReports } = require("../test-support/reports");
const { sampleResult } = require("../src/services/extraction-sample");
const { editable } = require("../src/services/extraction-data");
const { createAdapter } = require("../src/services/extraction-adapters");
const fs = require("node:fs/promises");
let fixture, alice, bob, mode = "success", gate, calls = 0;
before(async () => {
  fixture = await isolatedServer({ reportConfig: { extractionDemoEnabled: true, extractionTimeoutMs: 1000, reportMaxCount: 100 }, extractionAdapter: async (args) => {
    calls++; if (mode === "failure") throw new Error("secret provider stack");
    if (mode === "native") return createAdapter(fixture.config, fixture.reports.storage)(args);
    if (mode === "timeout") return new Promise(() => {});
    if (mode === "gate") await gate.promise;
    if (mode === "oversized") return { rows: Array.from({ length: 101 }, () => sampleResult().rows[0]) };
    if (mode === "invalid") return { rows: [{ testName: "bad", rawValue: { unsafe: true } }] };
    return sampleResult();
  } });
  alice = client(fixture); bob = client(fixture);
  for (const [browser, name] of [[alice, "alice"], [bob, "bob"]]) { await browser.bootstrap(); assert.equal((await browser.request("/api/auth/register", { method: "POST", body: { name, email: `${name}@extraction.test`, password: "Synthetic-password-123" } })).status, 201); }
});
after(async () => fixture?.close());
async function sample(browser = alice) { const r = await browser.request("/api/reports/sample", { method: "POST", body: { requestId: randomUUID() } }); assert.equal(r.status, 201); return r.data.report.id; }
async function start(id, browser = alice, requestId = randomUUID(), expectedVersion = 0) { return browser.request(`/api/reports/${id}/extraction`, { method: "POST", body: { requestId, expectedVersion } }); }
async function read(id, browser = alice) { return browser.request(`/api/reports/${id}/extraction`); }
async function run(job) { await fixture.reports.extractions.run(await fixture.reports.extractions.Job.findById(job.id)); }
async function success() { mode = "success"; const id = await sample(), started = await start(id); assert.equal(started.status, 202); await run(started.data.job); return { id, data: (await read(id)).data }; }
function rowsOf(data) { return data.review.rows.map((row) => Object.fromEntries(editable.map((key) => [key, row[key]]))); }
async function save(id, data, rows = rowsOf(data), markReviewed = false, browser = alice) { return browser.request(`/api/reports/${id}/review`, { method: "PUT", body: { resultId: data.result.id, expectedVersion: data.review.version, rows, markReviewed } }); }

test("dedicated synthetic sample queues, persists status and returns bounded provenance-labelled rows", async () => {
  const { id, data } = await success(); assert.equal(data.job.state, "succeeded"); assert.equal(data.result.origin, "synthetic-demo"); assert.equal(data.review.status, "draft");
  assert.equal(data.result.originalRows.length, 4); assert.equal(data.result.originalRows[1].parsedValue, null); assert.equal(data.result.originalRows[1].rawValue, "Negative");
  assert.equal(data.result.originalRows[2].comparator, "<"); assert.equal(data.result.originalRows[3].rawValue, null); assert.equal(data.result.originalRows[3].units, null);
  assert.ok(!JSON.stringify(data).includes("sourceHash")); assert.ok(!JSON.stringify(data).includes("storageKey")); assert.equal((await read(id)).data.review.version, 1);
});
test("arbitrary uploads cannot acquire demo results even with matching filenames", async () => {
  const png = (await syntheticReports()).png;
  const report = await upload(fixture, alice, png, { name: "synthetic-review-sample.png" });
  const response = await start(report.data.report.id); assert.equal(response.status, 503); assert.equal(response.data.error.code, "EXTRACTION_UNAVAILABLE");
  assert.equal((await read(report.data.report.id)).data.available, null);
});
test("authentication, CSRF and cross-owner protections cover sample, extraction, review and cancellation", async () => {
  const { id, data } = await success(), anon = client(fixture);
  assert.equal((await read(id, anon)).status, 401); assert.equal((await start(id, anon)).status, 401);
  assert.equal((await read(id, bob)).status, 404); assert.equal((await start(id, bob)).status, 404); assert.equal((await save(id, data, rowsOf(data), false, bob)).status, 404);
  assert.equal((await bob.request(`/api/reports/${id}/extraction/${data.job.id}/cancel`, { method: "POST", body: {} })).status, 404);
  for (const [path, body, method] of [[`/api/reports/${id}/extraction`, { requestId: randomUUID(), expectedVersion: 1 }, "POST"], ["/api/reports/sample", { requestId: randomUUID() }, "POST"], [`/api/reports/${id}/review`, {}, "PUT"], [`/api/reports/${id}/extraction/${data.job.id}/cancel`, {}, "POST"]]) assert.equal((await alice.request(path, { method, body, csrf: false })).status, 403);
  assert.equal((await read("bad")).status, 404);
});
test("duplicate and simultaneous start requests reserve only one durable attempt", async () => {
  const id = await sample(), requestId = randomUUID(); const results = await Promise.all([start(id, alice, requestId), start(id, alice, requestId)]);
  assert.deepEqual(results.map((r) => r.status), [202, 202]); assert.equal(results[0].data.job.id, results[1].data.job.id);
  assert.equal((await start(id)).status, 409); await run(results[0].data.job); assert.equal((await start(id, alice, requestId)).data.job.id, results[0].data.job.id);
});
test("failure remains visible, hides provider details and explicit retry creates a separate attempt", async () => {
  mode = "failure"; const id = await sample(), first = await start(id); await run(first.data.job); const failed = (await read(id)).data;
  assert.equal(failed.job.state, "failed"); assert.ok(!JSON.stringify(failed).includes("secret provider")); assert.equal(failed.result, null);
  mode = "success"; const retry = await start(id); await run(retry.data.job); const done = (await read(id)).data;
  assert.equal(done.attempts.length, 2); assert.equal(done.attempts[1].state, "failed"); assert.equal(done.job.state, "succeeded");
});
test("timeout is bounded and does not blindly retry the provider", async () => {
  mode = "timeout"; fixture.config.extractionTimeoutMs = 50; const id = await sample(), first = await start(id), beforeCalls = calls; await run(first.data.job);
  const failed = (await read(id)).data; assert.equal(failed.job.state, "failed"); assert.equal(failed.job.error.code, "EXTRACTION_TIMEOUT"); assert.equal(calls, beforeCalls + 1); mode = "success";
  fixture.config.extractionTimeoutMs = 1000;
});
test("invalid and oversized adapter results fail without storing extracted values", async () => {
  for (const value of ["invalid", "oversized"]) { mode = value; const id = await sample(), first = await start(id); await run(first.data.job); const failed = (await read(id)).data; assert.equal(failed.job.state, "failed"); assert.equal(failed.result, null); }
  mode = "success";
});
test("stale queued/running jobs fail with explicit interrupted recovery rather than provider replay", async () => {
  const id = await sample(), first = await start(id); const { Job } = fixture.reports.extractions;
  await Job.updateOne({ _id: first.data.job.id }, { $set: { state: "running", leaseToken: "stale", leaseUntil: new Date(0) } });
  const beforeCalls = calls; await fixture.reports.extractions.recover(); const failed = (await read(id)).data;
  assert.equal(failed.job.error.code, "INTERRUPTED"); assert.equal(calls, beforeCalls); const retry = await start(id); assert.equal(retry.status, 202); await run(retry.data.job);
});
test("corrections preserve originals, qualitative/comparator/unknown values and source provenance", async () => {
  const { id, data } = await success(), rows = rowsOf(data); rows[0].rawValue = ">13"; rows[0].sourcePage = 2; rows[1].units = null; rows[2].unknown = true; rows[2].rawValue = null;
  assert.equal((await save(id, data, rows)).status, 200); const next = (await read(id)).data;
  assert.equal(next.review.rows[0].parsedValue, 13); assert.equal(next.review.rows[0].comparator, ">"); assert.equal(next.review.rows[0].originalSourcePage, 1);
  assert.equal(next.result.originalRows[0].rawValue, "12.5"); assert.equal(next.review.rows[1].rawValue, "Negative"); assert.equal(next.review.rows[2].parsedValue, null);
  const original = rowsOf({ review: { rows: next.result.originalRows } }); assert.equal((await save(id, next, original)).status, 200); assert.equal((await read(id)).data.review.rows[0].rawValue, "12.5");
});
test("user-entered and removed rows remain distinct with versioned provenance", async () => {
  const { id, data } = await success(), rows = rowsOf(data); rows[0].removed = true;
  rows.push({ id: randomUUID(), testName: "Missed synthetic row", rawValue: "Negative", units: null, referenceRange: null, reportDate: null, sourcePage: null, unknown: false, unreadable: false, removed: false });
  assert.equal((await save(id, data, rows)).status, 200); const next = (await read(id)).data;
  assert.equal(next.review.rows[0].removed, true); assert.equal(next.review.rows.at(-1).provenance, "user-entered"); assert.equal(next.result.originalRows.length, 4);
  assert.equal(await fixture.reports.extractions.Review.countDocuments({ reportId: id }), 2);
});
test("two-tab optimistic conflicts never silently overwrite corrections", async () => {
  const { id, data } = await success(), rows = rowsOf(data); rows[0].rawValue = "21";
  const results = await Promise.all([save(id, data, rows), save(id, data)]); assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const stale = await save(id, data); assert.equal(stale.data.error.code, "REVISION_CONFLICT");
});
test("reviewed status is user review and becomes outdated after a later draft edit", async () => {
  const { id, data } = await success(); assert.equal((await save(id, data, rowsOf(data), true)).status, 200);
  const reviewed = (await read(id)).data; assert.equal(reviewed.review.status, "reviewed"); assert.ok(reviewed.review.reviewedAt);
  const rows = rowsOf(reviewed); rows[0].units = "corrected-unit"; assert.equal((await save(id, reviewed, rows)).status, 200);
  assert.equal((await read(id)).data.review.status, "outdated");
});
test("late extraction cannot replace corrections saved after the attempt started", async () => {
  const { id, data } = await success(); mode = "gate"; gate = {}; gate.promise = new Promise((resolve) => { gate.release = resolve; });
  const next = await start(id, alice, randomUUID(), data.review.version), work = run(next.data.job);
  await new Promise((r) => setTimeout(r, 20)); const rows = rowsOf(data); rows[0].rawValue = "18"; assert.equal((await save(id, data, rows)).status, 200);
  gate.release(); await work; const after = (await read(id)).data; assert.equal(after.review.rows[0].rawValue, "18"); assert.equal(after.result.id, data.result.id); assert.equal(after.job.state, "failed"); mode = "success";
});
test("local cancellation fences delayed results and allows an explicit newer attempt", async () => {
  mode = "gate"; gate = {}; gate.promise = new Promise((resolve) => { gate.release = resolve; }); const id = await sample(), first = await start(id), work = run(first.data.job);
  await new Promise((r) => setTimeout(r, 20)); assert.equal((await alice.request(`/api/reports/${id}/extraction/${first.data.job.id}/cancel`, { method: "POST", body: {} })).status, 200);
  gate.release(); await work; assert.equal((await read(id)).data.job.state, "cancelled"); assert.equal((await read(id)).data.result, null); mode = "success";
  const newer = await start(id); await run(newer.data.job); assert.equal((await read(id)).data.job.state, "succeeded");
});
test("deleting a report during extraction removes all linked records and prevents resurrection", async () => {
  const { id, data } = await success(); mode = "gate"; gate = {}; gate.promise = new Promise((resolve) => { gate.release = resolve; });
  const first = await start(id, alice, randomUUID(), data.review.version), work = run(first.data.job);
  await new Promise((r) => setTimeout(r, 20)); assert.equal((await alice.request(`/api/reports/${id}`, { method: "DELETE", body: {} })).status, 200); gate.release(); await work;
  for (const Model of [fixture.reports.extractions.Job, fixture.reports.extractions.Result, fixture.reports.extractions.Review]) assert.equal(await Model.countDocuments({ reportId: id }), 0);
  assert.equal((await read(id)).status, 404); mode = "success";
});
test("server rejects malformed reviews, impossible dates, invalid values and browser provenance", async () => {
  const { id, data } = await success();
  for (const mutate of [(r) => { r[0].ownerId = "browser"; }, (r) => { r[0].rawValue = null; }, (r) => { r[0].reportDate = "2026-02-30"; }, (r) => { r[0].units = "x".repeat(81); }, (r) => { r.pop(); }]) { const rows = rowsOf(data); mutate(rows); assert.equal((await save(id, data, rows)).status, 400); }
  assert.equal((await start(id, alice, randomUUID(), 99)).status, 409);
});
test("the real demo adapter verifies both the dedicated sample marker and immutable matching bytes", async () => {
  mode = "native"; const id = await sample(), first = await start(id); await run(first.data.job);
  assert.equal((await read(id)).data.job.state, "succeeded");
  const record = await fixture.Report.findById(id).select("+storageKey +sha256 +sampleVersion");
  await fs.writeFile(fixture.reports.storage.location(record.storageKey), Buffer.from("tampered synthetic source"));
  const next = await start(id, alice, randomUUID(), 1); await run(next.data.job);
  assert.equal((await read(id)).data.job.state, "failed"); assert.equal((await read(id)).data.result.originalRows[0].rawValue, "12.5"); mode = "success";
});
test("persistent dispatcher runs at most two attempts concurrently and drains queued work", async () => {
  mode = "gate"; gate = {}; gate.promise = new Promise((resolve) => { gate.release = resolve; });
  const ids = [await sample(), await sample(), await sample()]; for (const id of ids) assert.equal((await start(id)).status, 202);
  const Job = fixture.reports.extractions.Job;
  await fixture.reports.extractions.pump();
  async function waitFor(check) { const end = Date.now() + 3000; while (!await check()) { if (Date.now() > end) throw new Error("Dispatcher did not reach expected state"); await new Promise((r) => setTimeout(r, 10)); } }
  await waitFor(async () => await Job.countDocuments({ reportId: { $in: ids }, state: "running" }) === 2);
  assert.equal(await Job.countDocuments({ reportId: { $in: ids }, state: "queued" }), 1); gate.release();
  await waitFor(async () => await Job.countDocuments({ reportId: { $in: ids }, state: "succeeded" }) === 2);
  await fixture.reports.extractions.pump(); await waitFor(async () => await Job.countDocuments({ reportId: { $in: ids }, state: "succeeded" }) === 3); mode = "success";
});
