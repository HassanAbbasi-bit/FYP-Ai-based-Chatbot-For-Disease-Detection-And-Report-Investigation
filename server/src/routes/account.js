const express = require("express");
const { csrfSynchronisedProtection, limiter } = require("../middleware/security");
const { ReportError } = require("../services/report-errors");
const { NOTICE_VERSION } = require("../services/consent");
const { fail } = require("../middleware/errors");
function accountRoutes({ connection, config }) {
  const router = express.Router(), User = connection.models.User;
  router.use(limiter(60, 60000, (req) => String(req.user._id)));
  router.use((req, res, next) => ["GET", "HEAD"].includes(req.method) ? next() : csrfSynchronisedProtection(req, res, next));
  router.get("/", (req, res) => res.json({ name: req.user.name, healthContext: req.user.healthContext, consent: req.user.consent, version: req.user.privacyVersion,
    capabilities: { chat: config.chatProvider === "fastapi" ? "configured-fastapi" : "demo", symptoms: config.chatProvider === "fastapi", extractionDemo: config.extractionDemoEnabled }, noticeVersion: NOTICE_VERSION }));
  router.put("/", async (req, res) => {
    const b = req.body, keys = ["name", "healthContext", "consent", "expectedVersion"];
    if (!b || Array.isArray(b) || Object.keys(b).some((k) => !keys.includes(k)) || keys.some((k) => !(k in b)) || typeof b.name !== "string" || !b.name.trim() || b.name.length > 80 || !Number.isInteger(b.expectedVersion) || b.expectedVersion < 0) throw new ReportError(400, "INVALID_INPUT", "Supply a display name, optional context, consent and current settings version.");
    const health = b.healthContext, consent = b.consent;
    if (!health || Array.isArray(health) || Object.keys(health).some((k) => !["medications", "allergies", "conditions"].includes(k)) || ["medications", "allergies", "conditions"].some((k) => !(k in health) || health[k] !== null && (typeof health[k] !== "string" || health[k].length > 500)) || !consent || Array.isArray(consent) || Object.keys(consent).some((k) => !["chat", "reports", "profile", "noticeVersion"].includes(k)) || ["chat", "reports", "profile"].some((k) => typeof consent[k] !== "boolean") || consent.noticeVersion !== NOTICE_VERSION) throw new ReportError(400, "INVALID_INPUT", "Use optional text up to 500 characters or null, and explicit consent decisions for the current notice.");
    const saved = await User.findOneAndUpdate({ _id: req.user._id, deletionState: { $ne: "pending" }, privacyVersion: b.expectedVersion }, { $set: { name: b.name.trim(), healthContext: health, consent: { ...consent, decidedAt: new Date() } }, $inc: { privacyVersion: 1, contextFence: 1 } }, { returnDocument: "after", runValidators: true });
    if (!saved) throw new ReportError(409, "SETTINGS_CONFLICT", "Settings changed in another tab. Reload before saving again.");
    res.json({ saved: true, version: saved.privacyVersion });
  });
  router.use((e, req, res, next) => e instanceof ReportError ? fail(res, e.status, e.code, e.message) : next(e));
  return router;
}
module.exports = { accountRoutes };
