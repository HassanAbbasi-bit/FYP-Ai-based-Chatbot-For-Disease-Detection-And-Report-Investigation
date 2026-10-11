const { Worker } = require("node:worker_threads");
const path = require("node:path");
const { ReportError } = require("./report-errors");
const messages = {
  INVALID_FILE: "This file is empty or malformed. Choose a valid PDF, JPEG, or PNG.",
  UNSUPPORTED_FILE: "Only PDF, JPEG, and PNG files are supported.",
  ENCRYPTED_PDF: "Password-protected or encrypted PDFs are not supported. Choose an unencrypted copy.",
  IMAGE_DIMENSIONS: "Image dimensions exceed the allowed limit (8,192 per side and the configured pixel limit).",
  PDF_PAGES: "PDFs must contain between 1 and 200 pages.",
};
function validateReport(filename, config, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, "report-validation-worker.js"), {
      workerData: { filename, maxBytes: config.reportMaxBytes, maxPixels: config.reportMaxPixels },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32 },
      stdout: true, stderr: true, // Never expose parser warnings/filenames in operational logs.
    });
    worker.stdout.resume(); worker.stderr.resume();
    let settled = false;
    const finish = async (error, result) => {
      if (settled) return; settled = true;
      clearTimeout(timer); signal?.removeEventListener("abort", abort);
      await worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(new ReportError(408, "UPLOAD_ABORTED", "Upload cancelled or timed out. Retry the selected file."));
    const timer = setTimeout(() => finish(new ReportError(400, "INVALID_FILE", "File validation exceeded its resource limit.")), 10000);
    signal?.addEventListener("abort", abort, { once: true });
    worker.on("message", (result) => result.error ? finish(new ReportError(400, result.error, messages[result.error])) : finish(null, result));
    worker.on("error", () => finish(new ReportError(400, "INVALID_FILE", messages.INVALID_FILE)));
    worker.on("exit", () => { if (!settled) finish(new ReportError(400, "INVALID_FILE", messages.INVALID_FILE)); });
    if (signal?.aborted) abort();
  });
}
function safeFilename(input) {
  const name = path.posix.basename(String(input || "report").replaceAll("\\", "/"));
  return name.replace(/[^a-zA-Z0-9._ ()-]/g, "_").replace(/^\.+/, "").slice(0, 120) || "report";
}
function validateDeclaredType(name, suppliedMime, detected) {
  const extension = path.extname(name).toLowerCase();
  const allowed = { "application/pdf": [".pdf"], "image/png": [".png"], "image/jpeg": [".jpg", ".jpeg"] };
  if (!allowed[detected]?.includes(extension) || (suppliedMime && suppliedMime !== "application/octet-stream" && suppliedMime !== detected)) throw new ReportError(400, "TYPE_MISMATCH", "The filename or declared type does not match the detected file format.");
}
module.exports = { validateReport, safeFilename, validateDeclaredType };
