const { csrfSync } = require("csrf-sync");
const { rateLimit } = require("express-rate-limit");
const { fail } = require("./errors");
const { generateToken, csrfSynchronisedProtection } = csrfSync({ getTokenFromRequest: (req) => req.get("x-csrf-token") });
function checkOrigin(origin) {
  return (req, res, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.get("origin") !== origin) return fail(res, 403, "ORIGIN_FORBIDDEN", "This request must come from the configured application origin.");
    if (req.get("sec-fetch-site") === "cross-site") return fail(res, 403, "ORIGIN_FORBIDDEN", "Cross-site requests are not allowed.");
    next();
  };
}
function limiter(limit, windowMs, keyGenerator) {
  return rateLimit({ windowMs, limit, ...(keyGenerator ? { keyGenerator } : {}), standardHeaders: "draft-8", legacyHeaders: false, handler: (req, res) => fail(res, 429, "RATE_LIMITED", "Too many requests. Wait before trying again.") });
}
function requireAuth(User) {
  return async (req, res, next) => {
    if (!req.session.userId) return fail(res, 401, "UNAUTHENTICATED", "Please sign in to continue.");
    if (!req.session.authExpiresAt || Date.now() >= req.session.authExpiresAt) {
      return req.session.destroy((error) => error ? next(error) : fail(res, 401, "UNAUTHENTICATED", "Your session has expired. Please sign in again."));
    }
    const user = await User.findById(req.session.userId);
    if (!user) return fail(res, 401, "UNAUTHENTICATED", "Your session has expired. Please sign in again.");
    req.user = user;
    next();
  };
}
module.exports = { generateToken, csrfSynchronisedProtection, checkOrigin, limiter, requireAuth };
