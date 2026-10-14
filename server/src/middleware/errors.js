function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function completionReason(error) {
  if (error?.code === 18) return 'DATABASE_AUTHENTICATION';
  if (error?.code === 13) return 'DATABASE_PERMISSION';
  if (['MongoNetworkError', 'MongoNetworkTimeoutError'].includes(error?.name)) return 'DATABASE_NETWORK';
  if (['MongoServerSelectionError', 'MongooseServerSelectionError'].includes(error?.name)) return 'DATABASE_UNAVAILABLE';
  if (['MongoServerError', 'MongoWriteConcernError', 'MongoError'].includes(error?.name)) return 'DATABASE_ERROR';
  if (error?.code === 'ECONNRESET') return 'CONNECTION_RESET';
  if (['ERR_STREAM_PREMATURE_CLOSE', 'ECONNABORTED', 'EPIPE'].includes(error?.code)) return 'CONNECTION_CLOSED';
  return 'UNCLASSIFIED';
}
function errorHandler(connection) {
  return (error, req, res, next) => {
    if (res.headersSent) {
      // Keep future failures actionable without logging tokens, IDs, URLs,
      // request bodies or raw database errors that may contain credentials.
      console.error('REQUEST_COMPLETION_FAILED', JSON.stringify({ reason: completionReason(error), databaseConnected: connection.readyState === 1, responseEnded: Boolean(res.writableEnded) }));
      if(!res.writableEnded)res.destroy();
      return;
    }
    if (error.type === "entity.too.large") return fail(res, 413, "BODY_TOO_LARGE", "Request body exceeds the 100 KB limit.");
    if (error.type === "entity.parse.failed") return fail(res, 400, "INVALID_JSON", "Request body must be valid JSON.");
    if (error.code === "EBADCSRFTOKEN") return fail(res, 403, "CSRF_INVALID", "Your security token expired. Please retry.");
    if (error.code === 11000) return fail(res, 409, "EMAIL_IN_USE", "An account with this email already exists.");
    if (connection.readyState !== 1 || /^Mongo|MongooseServerSelection/.test(error.name || "")) return fail(res, 503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable. Please try again later.");
    return fail(res, 500, "INTERNAL_ERROR", "The server could not process this request.");
  };
}
module.exports = { fail, errorHandler };
