function fail(res, status, code, message) { return res.status(status).json({ error: { code, message } }); }
function errorHandler(connection) {
  return (error, req, res, next) => {
    if (res.headersSent) { console.error('REQUEST_COMPLETION_FAILED'); if(!res.writableEnded)res.destroy(); return; }
    if (error.type === "entity.too.large") return fail(res, 413, "BODY_TOO_LARGE", "Request body exceeds the 100 KB limit.");
    if (error.type === "entity.parse.failed") return fail(res, 400, "INVALID_JSON", "Request body must be valid JSON.");
    if (error.code === "EBADCSRFTOKEN") return fail(res, 403, "CSRF_INVALID", "Your security token expired. Please retry.");
    if (error.code === 11000) return fail(res, 409, "EMAIL_IN_USE", "An account with this email already exists.");
    if (connection.readyState !== 1 || /^Mongo|MongooseServerSelection/.test(error.name || "")) return fail(res, 503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable. Please try again later.");
    return fail(res, 500, "INTERNAL_ERROR", "The server could not process this request.");
  };
}
module.exports = { fail, errorHandler };
