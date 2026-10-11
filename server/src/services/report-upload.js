const Busboy = require("busboy");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { createHash } = require("node:crypto");
const { ReportError } = require("./report-errors");
function receiveUpload(req, storage, key, maxBytes, signal) {
  return new Promise((resolve, reject) => {
    let parser;
    try { parser = Busboy({ headers: req.headers, preservePath: true, limits: { files: 1, fields: 0, parts: 2, fileSize: maxBytes + 1, fieldNameSize: 32, headerPairs: 50 } }); }
    catch { reject(new ReportError(400, "INVALID_MULTIPART", "Use multipart/form-data with one file field named file.")); return; }
    let error, filename, mimeType, bytes = 0, fileCount = 0;
    const hash = createHash("sha256");
    let fileWork = Promise.resolve();
    const invalid = () => { error ||= new ReportError(400, "INVALID_MULTIPART", "Upload exactly one file named file and no extra fields."); };
    const stop = () => {
      error ||= new ReportError(408, "UPLOAD_ABORTED", "Upload cancelled or timed out. Retry the selected file.");
      req.unpipe(parser); parser.destroy(); req.resume();
    };
    let rawBytes = 0;
    const boundBody = (chunk) => { rawBytes += chunk.length; if (rawBytes > maxBytes + 65536) { error = new ReportError(413, "FILE_TOO_LARGE", "The upload exceeds the configured size limit."); stop(); } };
    req.on("data", boundBody);
    req.once("aborted", stop);
    signal.addEventListener("abort", stop, { once: true });
    parser.on("file", (field, stream, info) => {
      fileCount++;
      if (field !== "file" || fileCount !== 1) { invalid(); stream.resume(); return; }
      filename = info.filename; mimeType = info.mimeType;
      stream.on("limit", () => { error = new ReportError(413, "FILE_TOO_LARGE", "The upload exceeds the configured size limit."); });
      const digest = new Transform({ transform(chunk, encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes) error = new ReportError(413, "FILE_TOO_LARGE", "The upload exceeds the configured size limit.");
        hash.update(chunk); done(null, chunk);
      } });
      fileWork = pipeline(stream, digest, storage.createTemporary(key), { signal }).catch(() => {
        error ||= signal.aborted ? new ReportError(408, "UPLOAD_ABORTED", "Upload cancelled or timed out. Retry the selected file.") : new ReportError(503, "STORAGE_UNAVAILABLE", "Private storage is temporarily unavailable. Please retry.");
      });
    });
    for (const event of ["field", "filesLimit", "fieldsLimit", "partsLimit"]) parser.on(event, invalid);
    parser.on("error", () => { error ||= new ReportError(400, "INVALID_MULTIPART", "The upload was incomplete or malformed. Please retry."); });
    parser.once("close", async () => {
      await fileWork;
      req.removeListener("data", boundBody); req.removeListener("aborted", stop); signal.removeEventListener("abort", stop);
      if (!fileCount || !bytes || !filename) invalid();
      if (error) reject(error); else resolve({ filename, mimeType, size: bytes, sha256: hash.digest("hex") });
    });
    if (signal.aborted || req.aborted) stop(); else req.pipe(parser);
  });
}
module.exports = { receiveUpload };
