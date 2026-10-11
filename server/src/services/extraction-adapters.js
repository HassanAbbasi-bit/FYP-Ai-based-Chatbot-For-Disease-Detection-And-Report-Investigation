const { createHash } = require("node:crypto");
const { ReportError } = require("./report-errors");
const { sample, sampleResult } = require("./extraction-sample");
const { providerResult } = require("./extraction-data");
async function limitedJson(response, signal, maxBytes = 262144) {
  if (!response.body || !response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ReportError(502, "INVALID_PROVIDER_RESULT", "The extraction service returned an invalid result.");
  const chunks = []; let size = 0;
  try {
    for await (const chunk of response.body) {
      signal.throwIfAborted(); size += chunk.length;
      if (size > maxBytes) throw new Error();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { throw new ReportError(502, "INVALID_PROVIDER_RESULT", "The extraction service returned an invalid or oversized result."); }
}
function createAdapter(config, storage, connection) {
  return async ({ report, origin, signal }) => {
    const { handle, size } = await storage.open(report.storageKey);
    let bytes;
    try {
      if (size !== report.size || size > config.reportMaxBytes) throw new Error();
      bytes = await handle.readFile();
    } finally { await handle.close(); }
    if (createHash("sha256").update(bytes).digest("hex") !== report.sha256) throw new ReportError(409, "SOURCE_CHANGED", "The source file changed. Extraction was stopped.");
    if (origin === "synthetic-demo") {
      if (!config.extractionDemoEnabled || report.sampleVersion !== "synthetic-v1" || (await sample()).hash !== report.sha256) throw new ReportError(503, "EXTRACTION_UNAVAILABLE", "Extraction service not connected. Demo results are only available for the dedicated synthetic sample.");
      await new Promise((resolve, reject) => { const timer = setTimeout(done, 250); function done() { signal.removeEventListener("abort", abort); resolve(); } function abort() { clearTimeout(timer); reject(new Error("Cancelled")); } signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort(); });
      return sampleResult();
    }
    if (config.extractionProvider !== "fastapi") throw new ReportError(503, "EXTRACTION_UNAVAILABLE", "Extraction service not connected.");
    if (connection) await require("./consent").assertConsent(connection, report.ownerId, "reports");
    const body = new FormData();
    body.append("file", new Blob([bytes], { type: report.fileType }), `report.${report.fileType === "application/pdf" ? "pdf" : report.fileType === "image/png" ? "png" : "jpg"}`);
    let response;
    try { response = await fetch(`${config.aiServiceUrl}/api/reports/extract`, { method: "POST", body, headers: { "X-Internal-Key": config.aiInternalKey }, signal, redirect: "error" }); }
    catch { throw new ReportError(503, "PROVIDER_UNAVAILABLE", "The extraction service could not be reached. No automatic retry was made."); }
    if (!response.ok) { await response.body?.cancel(); throw new ReportError(502, "PROVIDER_ERROR", "The extraction service rejected the request. Check its configuration before retrying."); }
    return providerResult(await limitedJson(response, signal));
  };
}
module.exports = { createAdapter, limitedJson };
