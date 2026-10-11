const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const { isolatedServer, client } = require("../test-support/database");
const { syntheticReports, upload } = require("../test-support/reports");
const { LocalReportStorage } = require("../src/services/report-storage");
let fixture, a, b, files;
let afterPublish, beforePublish, afterRemove;
before(async () => {
  files = await syntheticReports();
  fixture = await isolatedServer({ reportConfig: { reportMaxBytes: 8192, reportMaxCount: 100, reportMaxTotalBytes: 8192 * 100, reportMaxPixels: 1000000 },
    reportHooks: { afterPublish: (r) => afterPublish?.(r), beforePublish: (r) => beforePublish?.(r), afterRemove: (r) => afterRemove?.(r) } });
  a = client(fixture); b = client(fixture);
  for (const [browser, email] of [[a, "reports-a@example.com"], [b, "reports-b@example.com"]]) {
    await browser.bootstrap();
    assert.equal((await browser.request("/api/auth/register", { method: "POST", body: { name: "Report Tester", email, password: "a synthetic testing passphrase" } })).status, 201);
  }
});
after(async () => { if (fixture) await fixture.close(); });
const reportPath = (id) => `/api/reports/${id}`;
async function countFiles() { return (await fs.readdir(fixture.config.reportStorageDir)).filter((name) => /\.(part|blob)$/.test(name)).length; }
async function waitFor(work) {
  const start = Date.now();
  while (!await work()) { if (Date.now() - start > 5000) throw new Error("Synthetic operation did not settle"); await new Promise((r) => setTimeout(r, 20)); }
}
test("PDF, JPEG and PNG uploads are private, correctly typed and explicitly unanalysed", async () => {
  for (const [key, name, type] of [["png", "synthetic.png", "image/png"], ["jpeg", "synthetic.jpg", "image/jpeg"], ["pdf", "synthetic.pdf", "application/pdf"]]) {
    const result = await upload(fixture, a, files[key], { name, type });
    assert.equal(result.status, 201, JSON.stringify(result.data));
    assert.equal(result.data.report.fileType, type); assert.equal(result.data.report.status, "uploaded");
    assert.equal(result.data.report.size, files[key].length);
    assert.ok(!JSON.stringify(result.data).includes(fixture.config.reportStorageDir));
    assert.equal(result.data.report.storageKey, undefined); assert.equal(result.data.report.ownerId, undefined);
    const delivered = await fetch(fixture.base + reportPath(result.data.report.id) + "/file", { headers: { Cookie: a.cookie } });
    assert.equal(delivered.status, 200); assert.equal(delivered.headers.get("content-type"), type);
    assert.equal(delivered.headers.get("cache-control"), "private, no-store");
    assert.equal(delivered.headers.get("x-content-type-options"), "nosniff");
    assert.equal(delivered.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.ok(delivered.headers.get("content-security-policy").includes("sandbox"));
    assert.ok(delivered.headers.get("content-disposition").startsWith(key === "pdf" ? "attachment" : "inline"));
    assert.deepEqual(Buffer.from(await delivered.arrayBuffer()), files[key]);
  }
});
test("invalid, empty, malformed, unsupported, mismatched and oversized files leave no temporary files", async () => {
  const beforeCount = await countFiles();
  for (const [bytes, options, status] of [[Buffer.alloc(0), {}, 400], [Buffer.from("not an image"), {}, 400],
    [files.png.subarray(0, 30), {}, 400], [Buffer.from("<html>untrusted</html>"), { name: "fake.pdf", type: "application/pdf" }, 400],
    [files.png, { name: "wrong.jpg", type: "image/jpeg" }, 400], [files.png, { name: "wrong.exe", type: "image/png" }, 400],
    [Buffer.alloc(8193), {}, 413]]) {
    const result = await upload(fixture, a, bytes, options);
    assert.equal(result.status, status, JSON.stringify(result.data));
    assert.equal(await countFiles(), beforeCount);
  }
});
test("encrypted PDFs and excessive image dimensions are rejected with useful errors", async () => {
  const encrypted = await upload(fixture, a, files.encrypted, { name: "encrypted.pdf", type: "application/pdf" });
  assert.equal(encrypted.status, 400); assert.equal(encrypted.data.error.code, "ENCRYPTED_PDF");
  const sharp = require("sharp");
  const large = await sharp({ create: { width: 8193, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  const dimensions = await upload(fixture, a, large);
  assert.equal(dimensions.status, 400); assert.equal(dimensions.data.error.code, "IMAGE_DIMENSIONS");
});
test("missing, extra and wrongly named multipart fields are rejected and cleaned", async () => {
  const beforeCount = await countFiles();
  for (const [bytes, options] of [[undefined, {}], [files.png, { extraFile: true }], [files.png, { field: "report" }], [files.png, { extraField: true }]]) {
    assert.equal((await upload(fixture, a, bytes, options)).status, 400);
    assert.equal(await countFiles(), beforeCount);
  }
});
test("upload authentication, CSRF and Origin checks run before writing files", async () => {
  const beforeCount = await countFiles();
  assert.equal((await upload(fixture, client(fixture), files.png)).status, 401);
  assert.equal((await upload(fixture, a, files.png, { csrf: false })).status, 403);
  assert.equal((await upload(fixture, a, files.png, { origin: "https://untrusted.example" })).status, 403);
  assert.equal(await countFiles(), beforeCount);
});
test("all report endpoints require a session and deletion requires CSRF", async () => {
  const report = (await upload(fixture, a, files.png)).data.report;
  const anonymous = client(fixture);
  for (const path of ["/api/reports", reportPath(report.id), reportPath(report.id) + "/file"]) assert.equal((await anonymous.request(path)).status, 401);
  assert.equal((await anonymous.request(reportPath(report.id), { method: "DELETE", body: {} })).status, 401);
  assert.equal((await a.request(reportPath(report.id), { method: "DELETE", body: {}, csrf: false })).status, 403);
});
test("cross-user metadata, file and deletion are indistinguishable from absent reports", async () => {
  const report = (await upload(fixture, a, files.png)).data.report;
  for (const [method, suffix] of [["GET", ""], ["GET", "/file"], ["DELETE", ""]]) {
    const inaccessible = await b.request(reportPath(report.id) + suffix, { method, body: method === "DELETE" ? {} : undefined });
    const absent = await b.request(reportPath("012345678901234567890123") + suffix, { method, body: method === "DELETE" ? {} : undefined });
    assert.equal(inaccessible.status, 404); assert.deepEqual(inaccessible.data, absent.data);
  }
  assert.equal((await b.request("/api/reports")).data.reports.length, 0);
});
test("filenames cannot traverse storage or inject headers, and keys never reach the client", async () => {
  const result = await upload(fixture, a, files.png, { name: "../../private\\unsafe\"\r\n-name.png" });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  assert.ok(!/[\r\n"/\\]/.test(result.data.report.originalFilename));
  const record = await fixture.Report.findById(result.data.report.id).select("+storageKey");
  assert.match(record.storageKey, /^[a-f\d-]{36}$/); assert.ok(!record.storageKey.includes("unsafe"));
  assert.throws(() => fixture.reports.storage.location("../../escape"), (error) => error.code === "STORAGE_UNAVAILABLE");
  for (const id of ["bad", "g".repeat(24)]) assert.equal((await a.request(reportPath(id))).status, 404);
});
test("sequential retries reconcile the same bytes and reject reused IDs with different bytes", async () => {
  const id = randomUUID();
  const first = await upload(fixture, a, files.png, { id });
  const retry = await upload(fixture, a, files.png, { id });
  assert.equal(retry.status, 200); assert.equal(retry.data.report.id, first.data.report.id);
  const different = await upload(fixture, a, files.jpeg, { id, name: "changed.jpg", type: "image/jpeg" });
  assert.equal(different.status, 409); assert.equal(different.data.error.code, "UPLOAD_ID_REUSED");
  assert.equal(await fixture.Report.countDocuments({ uploadId: id }), 1);
});
test("simultaneous duplicates cannot reserve two files or quota slots", async () => {
  const id = randomUUID();
  const results = await Promise.all([upload(fixture, a, files.png, { id }), upload(fixture, a, files.png, { id })]);
  assert.ok(results.every((r) => [200, 201, 409].includes(r.status)), JSON.stringify(results.map((r) => r.data)));
  assert.equal(await fixture.Report.countDocuments({ uploadId: id }), 1);
});
test("report listing has stable owner-scoped pagination and validates cursors", async () => {
  const ids = [];
  for (let i = 0; i < 3; i++) ids.push((await upload(fixture, b, files.png)).data.report.id);
  let cursor = null; const seen = [];
  do {
    const page = await b.request(`/api/reports?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(page.status, 200); seen.push(...page.data.reports.map((r) => r.id)); cursor = page.data.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, [...ids].reverse());
  for (const query of ["limit=0", "limit=51", "cursor=bad", "ownerId=someone"]) assert.equal((await a.request(`/api/reports?${query}`)).status, 400);
});
test("cancelled uploads clean temporary files and quota reservations", async () => {
  const id = randomUUID(), boundary = "synthetic-cancel-boundary";
  const req = http.request(`${fixture.base}/api/reports`, { method: "POST", headers: { Cookie: a.cookie, Origin: fixture.config.origin, "x-csrf-token": a.token, "x-upload-id": id, "content-type": `multipart/form-data; boundary=${boundary}` } });
  req.on("error", () => {});
  req.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n`);
  req.write(files.png.subarray(0, 30));
  await waitFor(async () => await fixture.Report.exists({ uploadId: id }));
  req.destroy();
  await waitFor(async () => !await fixture.Report.exists({ uploadId: id }));
  assert.equal((await fs.readdir(fixture.config.reportStorageDir)).filter((name) => name.endsWith(".part")).length, 0);
});
test("storage failure before publish rolls back and releases the account reservation", async () => {
  const id = randomUUID();
  beforePublish = () => { throw new Error("Synthetic storage failure"); };
  try { assert.equal((await upload(fixture, a, files.png, { id })).status, 503); }
  finally { beforePublish = null; }
  assert.equal(await fixture.Report.countDocuments({ uploadId: id }), 0);
  assert.equal((await upload(fixture, a, files.png, { id })).status, 201);
});
test("failure after a private write cannot leave an untracked original", async () => {
  const id = randomUUID(), beforeCount = await countFiles();
  afterPublish = () => { throw new Error("Synthetic commit failure"); };
  try { assert.equal((await upload(fixture, a, files.png, { id })).status, 503); }
  finally { afterPublish = null; }
  assert.equal(await fixture.Report.countDocuments({ uploadId: id }), 0);
  assert.equal(await countFiles(), beforeCount);
});
test("cleanup preserves active uploads and repairs stale incomplete records and old orphans", async () => {
  const id = randomUUID(); let entered, release;
  const ready = new Promise((r) => { entered = r; }), gate = new Promise((r) => { release = r; });
  beforePublish = async () => { entered(); await gate; };
  const pending = upload(fixture, a, files.png, { id }); await ready;
  try {
    const record = await fixture.Report.findOne({ uploadId: id }).select("+storageKey");
    await fixture.Report.updateOne({ _id: record._id }, { $set: { leaseUntil: new Date(0) } });
    await fixture.reports.cleanup();
    assert.ok(await fixture.Report.exists({ _id: record._id }));
    assert.ok((await fs.stat(fixture.reports.storage.location(record.storageKey, true))).size);
  } finally { beforePublish = null; release(); }
  assert.equal((await pending).status, 201);
  const report = (await upload(fixture, a, files.png)).data.report;
  await fixture.Report.updateOne({ _id: report.id }, { $set: { status: "uploading", leaseUntil: new Date(0) } });
  const orphan = randomUUID(); await fs.writeFile(fixture.reports.storage.location(orphan, true), "synthetic orphan");
  await fs.utimes(fixture.reports.storage.location(orphan, true), new Date(0), new Date(0));
  await fixture.reports.cleanup();
  assert.equal(await fixture.Report.countDocuments({ _id: report.id }), 0);
  await assert.rejects(fs.stat(fixture.reports.storage.location(orphan, true)), (error) => error.code === "ENOENT");
});
test("failed file deletion stays recoverable and never reports success while the file remains", async () => {
  const report = (await upload(fixture, a, files.png)).data.report;
  const record = await fixture.Report.findById(report.id).select("+storageKey");
  const original = fixture.reports.storage.remove;
  fixture.reports.storage.remove = async () => { const e = new Error("Synthetic unlink failure"); e.code = "EACCES"; throw e; };
  try { assert.equal((await a.request(reportPath(report.id), { method: "DELETE", body: {} })).status, 503); }
  finally { fixture.reports.storage.remove = original; }
  assert.ok(await fs.stat(fixture.reports.storage.location(record.storageKey)));
  assert.equal((await fixture.Report.findById(report.id)).status, "deleting");
  assert.equal((await a.request(reportPath(report.id) + "/file")).status, 404);
  assert.equal((await a.request(reportPath(report.id), { method: "DELETE", body: {} })).status, 200);
  await assert.rejects(fs.stat(fixture.reports.storage.location(record.storageKey)), (error) => error.code === "ENOENT");
  assert.equal((await a.request(reportPath(report.id), { method: "DELETE", body: {} })).status, 404);
});
test("a metadata failure after unlink is repaired through repeat deletion", async () => {
  const report = (await upload(fixture, a, files.png)).data.report;
  afterRemove = () => { throw new Error("Synthetic metadata failure"); };
  try { assert.equal((await a.request(reportPath(report.id), { method: "DELETE", body: {} })).status, 503); }
  finally { afterRemove = null; }
  assert.equal((await fixture.Report.findById(report.id)).status, "deleting");
  assert.equal((await a.request(reportPath(report.id), { method: "DELETE", body: {} })).status, 200);
  assert.equal(await fixture.Report.countDocuments({ _id: report.id }), 0);
});
test("account count/storage limits and per-user upload rate limits are enforced", async () => {
  const limited = await isolatedServer({ reportConfig: { reportMaxBytes: 4096, reportMaxCount: 1, reportMaxTotalBytes: 4096 }, limits: { upload: 2 } });
  try {
    const browser = client(limited); await browser.bootstrap();
    await browser.request("/api/auth/register", { method: "POST", body: { name: "Quota Tester", email: "quota@example.com", password: "a synthetic testing passphrase" } });
    assert.equal((await upload(limited, browser, files.png)).status, 201);
    const overCount = await upload(limited, browser, files.png);
    assert.equal(overCount.status, 413); assert.equal(overCount.data.error.code, "STORAGE_LIMIT");
    assert.equal((await upload(limited, browser, files.png)).status, 429);
  } finally { await limited.close(); }
});
test("another server cannot share an active private local storage root", async () => {
  const other = new LocalReportStorage(fixture.config.reportStorageDir);
  await assert.rejects(other.initialize(), (error) => error.code === "STORAGE_UNAVAILABLE");
});
test("database outage after file write retains tracking and cleanup recovers when it returns", async () => {
  const id = randomUUID(), original = fixture.Report.findOneAndUpdate;
  afterPublish = () => { fixture.Report.findOneAndUpdate = () => { throw new Error("Synthetic database outage"); }; };
  try { assert.equal((await upload(fixture, a, files.png, { id })).status, 503); }
  finally { afterPublish = null; fixture.Report.findOneAndUpdate = original; }
  const record = await fixture.Report.findOne({ uploadId: id }).select("+storageKey");
  assert.equal(record.status, "uploading"); assert.ok(await fs.stat(fixture.reports.storage.location(record.storageKey)));
  await fixture.Report.updateOne({ _id: record._id }, { $set: { leaseUntil: new Date(0) } });
  await fixture.reports.cleanup();
  assert.equal(await fixture.Report.countDocuments({ uploadId: id }), 0);
  await assert.rejects(fs.stat(fixture.reports.storage.location(record.storageKey)), (error) => error.code === "ENOENT");
});
test("report API returns safe 503 during database unavailability", async () => {
  await fixture.mongo.stop();
  assert.equal((await a.request("/api/reports")).status, 503);
  assert.equal((await upload(fixture, a, files.png)).status, 503);
});
