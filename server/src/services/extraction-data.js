const { randomUUID } = require("node:crypto");
const { ReportError } = require("./report-errors");
const MAX_ROWS = 100;
const bad = () => new ReportError(400, "INVALID_REVIEW", "Review fields are invalid. Use at most 100 rows and the documented field limits.");
function text(value, max, nullable = true) {
  if (value === null && nullable) return null;
  if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw bad();
  return value;
}
function date(value) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw bad();
  return value;
}
// Parse only a complete decimal representation. Missing and qualitative values stay null.
function numeric(raw) {
  if (raw === null) return { parsedValue: null, comparator: null };
  const match = /^\s*(<=|>=|<|>)?\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*$/.exec(raw);
  if (!match || !Number.isFinite(Number(match[2]))) return { parsedValue: null, comparator: null };
  return { parsedValue: Number(match[2]), comparator: match[1] || null };
}
function fields(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw bad();
  const testName = text(row.testName, 160, false);
  if (!testName.trim() || typeof row.unknown !== "boolean" || typeof row.unreadable !== "boolean") throw bad();
  const rawValue = text(row.rawValue, 200);
  if ((row.unknown || row.unreadable) && rawValue !== null) throw bad();
  if (!row.unknown && !row.unreadable && (rawValue === null || !rawValue.trim())) throw bad();
  if (row.sourcePage !== null && (!Number.isInteger(row.sourcePage) || row.sourcePage < 1 || row.sourcePage > 200)) throw bad();
  return { testName, rawValue, ...numeric(rawValue), units: text(row.units, 80), referenceRange: text(row.referenceRange, 200),
    reportDate: date(row.reportDate), sourcePage: row.sourcePage, unknown: row.unknown, unreadable: row.unreadable };
}
const editable = ["id", "testName", "rawValue", "units", "referenceRange", "reportDate", "sourcePage", "unknown", "unreadable", "removed"];
function corrections(rows, originals) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) throw bad();
  const seen = new Set(), original = new Map(originals.map((row) => [row.id, row]));
  const clean = rows.map((row) => {
    if (!row || Object.keys(row).some((key) => !editable.includes(key)) || typeof row.id !== "string" || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(row.id) || seen.has(row.id) || typeof row.removed !== "boolean") throw bad();
    seen.add(row.id);
    const source = original.get(row.id);
    return { id: row.id, ...fields(row), removed: row.removed, provenance: source ? "extracted" : "user-entered",
      originalSourcePage: source?.sourcePage ?? null, uncertain: source?.uncertain || false, reviewReason: source?.reviewReason || null };
  });
  // Removed extracted rows remain as tombstones; never discard their provenance.
  if (originals.some((row) => !seen.has(row.id))) throw bad();
  return clean;
}
function providerResult(data) {
  try {
    if (!data || typeof data !== "object" || typeof data.report_id !== "string" || data.report_id.length > 120 || !Array.isArray(data.tests) || data.tests.length > MAX_ROWS) throw bad();
    const rows = data.tests.map((item) => {
      if (!item || !["string", "number"].includes(typeof item.value) && item.value !== null || typeof item.needs_review !== "boolean") throw bad();
      const rawValue = item.value === null ? null : String(item.value);
      return { id: randomUUID(), ...fields({ testName: item.name, rawValue, units: item.unit ?? null, referenceRange: item.reference_range ?? null,
        reportDate: data.report_date ?? null, sourcePage: item.page, unknown: rawValue === null, unreadable: false }),
        uncertain: item.needs_review, reviewReason: text(item.review_reason ?? null, 300), confidence: null };
    });
    return { providerReportId: data.report_id, rows };
  } catch { throw new ReportError(502, "INVALID_PROVIDER_RESULT", "The extraction service returned an invalid or oversized result."); }
}
module.exports = { MAX_ROWS, numeric, corrections, providerResult, editable };
