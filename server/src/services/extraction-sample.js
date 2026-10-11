const sharp = require("sharp");
const { createHash, randomUUID } = require("node:crypto");
let cached;
function sample() {
  cached ||= (async () => {
    const lines = ["DEMO EXTRACTION - SYNTHETIC SAMPLE", "Not a patient report. No medical interpretation.",
      "Sample measurement A: 12.5 | unit: sample-unit | reported range: 10-20",
      "Sample screen B: Negative | unit: missing | range: not reported",
      "Sample threshold C: <5 | unit: sample-unit | range: not reported",
      "Sample unreadable D: unknown | unit: missing | range: not reported", "Sample date: 2026-01-01 | Source page: 1"];
    const svg = `<svg width="1000" height="360" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="white"/>${lines.map((line, i) => `<text x="24" y="${42 + i * 40}" font-size="19" font-family="sans-serif" fill="black">${line.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</text>`).join("")}</svg>`;
    const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
    return { bytes, hash: createHash("sha256").update(bytes).digest("hex") };
  })();
  return cached;
}
function sampleResult() {
  return { providerReportId: "synthetic-sample-v1", rows: [
    { testName: "Sample measurement A", rawValue: "12.5", parsedValue: 12.5, comparator: null, units: "sample-unit", referenceRange: "10-20", unknown: false, unreadable: false },
    { testName: "Sample screen B", rawValue: "Negative", parsedValue: null, comparator: null, units: null, referenceRange: null, unknown: false, unreadable: false },
    { testName: "Sample threshold C", rawValue: "<5", parsedValue: 5, comparator: "<", units: "sample-unit", referenceRange: null, unknown: false, unreadable: false },
    { testName: "Sample unreadable D", rawValue: null, parsedValue: null, comparator: null, units: null, referenceRange: null, unknown: true, unreadable: true },
  ].map((row) => ({ ...row, id: randomUUID(), reportDate: "2026-01-01", sourcePage: 1, uncertain: row.unknown, reviewReason: row.unknown ? "Synthetic unreadable example" : null, confidence: null })) };
}
module.exports = { sample, sampleResult };
