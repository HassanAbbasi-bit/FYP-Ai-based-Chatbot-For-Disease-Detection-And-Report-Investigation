const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createHash } = require("node:crypto");
const Busboy = require("busboy");
const { createAdapter } = require("../src/services/extraction-adapters");
const { providerResult } = require("../src/services/extraction-data");
const { readConfig } = require("../src/config");
let server, url, mode = "success", received;
const bytes = Buffer.from("synthetic adapter transport only");
const result = { report_id: "synthetic-provider-id", report_date: null, tests: [{ test_id: "t1", name: "Synthetic screen", value: "Negative", unit: null, reference_range: null, page: 1, needs_review: true, review_reason: "Review source" }] };
before(async () => {
  server = http.createServer((req, res) => {
    received = { path: req.url, key: req.headers["x-internal-key"], files: [] };
    const parser = Busboy({ headers: req.headers });
    parser.on("file", (field, stream, info) => { const chunks = []; stream.on("data", (chunk) => chunks.push(chunk)); stream.on("end", () => received.files.push({ field, info, bytes: Buffer.concat(chunks) })); });
    parser.on("close", () => {
      if (mode === "redirect") { res.writeHead(302, { Location: "http://127.0.0.1:1/never-forward-credentials" }); res.end(); return; }
      if (mode === "failure") { res.writeHead(401); res.end("sensitive provider details"); return; }
      if (mode === "timeout") return;
      res.setHeader("Content-Type", "application/json");
      res.end(mode === "oversized" ? JSON.stringify({ padding: "x".repeat(262145) }) : mode === "invalid" ? '{"tests":false}' : JSON.stringify(result));
    });
    req.pipe(parser);
  }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r)); url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); });
function adapter() { return createAdapter({ extractionProvider: "fastapi", aiServiceUrl: url, aiInternalKey: "synthetic-test-key", reportMaxBytes: 1000 }, { open: async () => ({ size: bytes.length, handle: { readFile: async () => bytes, close: async () => {} } }) }); }
const report = { storageKey: "internal", fileType: "image/png", size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
test("FastAPI adapter sends only authenticated multipart file bytes and validates the supplied extraction schema", async () => {
  mode = "success"; const data = await adapter()({ report, origin: "fastapi", signal: AbortSignal.timeout(2000) });
  assert.equal(received.path, "/api/reports/extract"); assert.equal(received.key, "synthetic-test-key"); assert.equal(received.files.length, 1); assert.equal(received.files[0].field, "file"); assert.deepEqual(received.files[0].bytes, bytes); assert.equal(received.files[0].info.filename, "report.png");
  assert.equal(data.rows[0].rawValue, "Negative"); assert.equal(data.rows[0].parsedValue, null); assert.equal(data.rows[0].units, null); assert.equal(data.rows[0].uncertain, true);
});
test("adapter rejects changed source, redirects, malformed/oversized JSON and safe-maps provider errors", async () => {
  await assert.rejects(adapter()({ report: { ...report, sha256: "changed" }, origin: "fastapi", signal: AbortSignal.timeout(1000) }), (e) => e.code === "SOURCE_CHANGED");
  for (const value of ["redirect", "failure", "invalid", "oversized"]) { mode = value; await assert.rejects(adapter()({ report, origin: "fastapi", signal: AbortSignal.timeout(1000) }), (e) => !e.message.includes("sensitive") && ["PROVIDER_UNAVAILABLE", "PROVIDER_ERROR", "INVALID_PROVIDER_RESULT"].includes(e.code)); }
});
test("adapter obeys abort deadlines without automatic provider retry", async () => {
  mode = "timeout"; await assert.rejects(adapter()({ report, origin: "fastapi", signal: AbortSignal.timeout(30) }), (e) => e.code === "PROVIDER_UNAVAILABLE");
});
test("provider output cannot smuggle nested values, invalid pages or excessive rows", () => {
  for (const tests of [[{ ...result.tests[0], value: { value: 42 } }], [{ ...result.tests[0], page: 0 }], Array.from({ length: 101 }, () => result.tests[0])]) assert.throws(() => providerResult({ ...result, tests }), (e) => e.code === "INVALID_PROVIDER_RESULT");
});
test("demo is off by default and cannot be enabled in production; real adapter requires explicit private configuration", () => {
  const env = { MONGODB_URI: "mongodb://127.0.0.1/test", SESSION_SECRET: "a".repeat(64), APP_ORIGIN: "http://localhost:5173" };
  assert.equal(readConfig(env).extractionDemoEnabled, false); assert.equal(readConfig(env).extractionProvider, "off");
  assert.throws(() => readConfig({ ...env, NODE_ENV: "production", APP_ORIGIN: "https://example.test", EXTRACTION_DEMO_ENABLED: "true" }), /disabled in production/);
  assert.throws(() => readConfig({ ...env, EXTRACTION_PROVIDER: "fastapi", AI_SERVICE_URL: url }), /AI_INTERNAL_KEY/);
});
