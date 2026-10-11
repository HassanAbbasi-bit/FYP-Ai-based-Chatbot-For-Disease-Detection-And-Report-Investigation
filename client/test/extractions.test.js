import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractionApi, editableRows } from "../src/api/extractions.js";
import { clearCsrf } from "../src/api/client.js";
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; clearCsrf(); });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
test("review saves preserve explicit unknowns and strip browser-ineligible original/provenance fields", async () => {
  let captured;
  globalThis.fetch = async (url, options) => { if (url === "/api/auth/csrf") return json({ csrfToken: "synthetic" }); captured = options; return json({ version: 2 }); };
  const row = { id: "row", testName: "Synthetic", rawValue: null, units: null, referenceRange: null, reportDate: null, sourcePage: null, unknown: true, unreadable: true, removed: false, provenance: "extracted", parsedValue: 0, originalSourcePage: 1 };
  await extractionApi.save("report", { resultId: "result", expectedVersion: 1, rows: [row], markReviewed: false });
  const body = JSON.parse(captured.body); assert.equal(body.rows[0].rawValue, null); assert.equal(body.rows[0].parsedValue, undefined); assert.equal(body.rows[0].provenance, undefined); assert.equal(body.expectedVersion, 1); assert.equal(captured.headers["x-csrf-token"], "synthetic");
});
test("extraction CSRF retry preserves the intended attempt UUID and expected revision", async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => { if (url === "/api/auth/csrf") return json({ csrfToken: "synthetic" }); calls.push(JSON.parse(options.body)); return calls.length === 1 ? json({ error: { code: "CSRF_INVALID", message: "Expired" } }, 403) : json({ job: { id: "job" } }); };
  await extractionApi.start("report", "synthetic-request-id", 3); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]);
});
test("qualitative values and removed-row tombstones are preserved for review", () => {
  const rows = editableRows([{ id: "row", rawValue: "Negative", removed: true, unknown: false, unreadable: false }]); assert.equal(rows[0].rawValue, "Negative"); assert.equal(rows[0].removed, true);
});
