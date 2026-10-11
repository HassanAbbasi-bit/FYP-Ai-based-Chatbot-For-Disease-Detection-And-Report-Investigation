class ReportError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const reportNotFound = () => new ReportError(404, "NOT_FOUND", "Report not found.");
const storageUnavailable = () => new ReportError(503, "STORAGE_UNAVAILABLE", "Private storage is temporarily unavailable. Please retry.");
module.exports = { ReportError, reportNotFound, storageUnavailable };
