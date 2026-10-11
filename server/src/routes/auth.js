const express = require("express");
const { promisify } = require("node:util");
const { publicUser } = require("../models/User");
const { hashPassword, verifyPassword } = require("../services/password");
const { validateAuth } = require("../services/validation");
const { generateToken, csrfSynchronisedProtection, limiter, requireAuth } = require("../middleware/security");
const { fail } = require("../middleware/errors");
function authRoutes({ User, config, limits = {} }) {
  const router = express.Router();
  router.get("/csrf", limiter(limits.csrf || 100, 15 * 60 * 1000), async (req, res) => {
    const csrfToken = generateToken(req);
    await promisify(req.session.save).call(req.session);
    res.json({ csrfToken });
  });
  router.get("/me", requireAuth(User), (req, res) => res.json({ user: publicUser(req.user) }));
  async function establishSession(req, res, user, status = 200) {
    await promisify(req.session.regenerate).call(req.session);
    req.session.userId = user._id.toString();
    req.session.authExpiresAt = Date.now() + config.sessionTtlMs;
    const csrfToken = generateToken(req);
    await promisify(req.session.save).call(req.session);
    res.status(status).json({ user: publicUser(user), csrfToken });
  }
  router.post("/register", limiter(limits.register || 5, 60 * 60 * 1000), csrfSynchronisedProtection, async (req, res) => {
    const input = validateAuth(req.body, true);
    if (input.error) return fail(res, 400, "INVALID_INPUT", input.error);
    const { name, email, password } = input.value;
    const passwordHash = await hashPassword(password);
    // The unique index arbitrates concurrent registrations, not a pre-check.
    const user = await User.create({ name, email, passwordHash });
    await establishSession(req, res, user, 201);
  });
  router.post("/login", limiter(limits.login || 10, 15 * 60 * 1000), csrfSynchronisedProtection, async (req, res) => {
    const input = validateAuth(req.body, false);
    if (input.error) return fail(res, 400, "INVALID_INPUT", input.error);
    const user = await User.findOne({ email: input.value.email }).select("+passwordHash");
    const matches = await verifyPassword(user?.passwordHash, input.value.password);
    if (!user || !matches || user.deletionState === "pending") return fail(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
    await establishSession(req, res, user);
  });
  router.post("/logout", csrfSynchronisedProtection, async (req, res) => {
    if (req.body && Object.keys(req.body).length) return fail(res, 400, "INVALID_INPUT", "Logout does not accept account fields.");
    await promisify(req.session.destroy).call(req.session);
    res.clearCookie(config.cookieName, { httpOnly: true, secure: config.production, sameSite: "lax", path: "/" });
    res.json({ message: "Signed out." });
  });
  return router;
}
module.exports = { authRoutes };
