const express = require("express");
const { csrfSynchronisedProtection, limiter } = require("../middleware/security");
const { ReportError } = require("../services/report-errors");
const { fail } = require("../middleware/errors");
function symptomRoutes(gateway) {
  const router = express.Router();
  router.post("/", limiter(10, 15 * 60000, (req) => String(req.user._id)), csrfSynchronisedProtection, async (req, res) => {
    const b = req.body;
    if (!b || Object.keys(b).some((k) => !["symptoms", "duration", "severity", "additional_notes"].includes(k)) || !Array.isArray(b.symptoms) || !b.symptoms.length || b.symptoms.length > 10 || b.symptoms.some((s) => typeof s !== "string" || !s.trim() || s.length > 200) || ["duration", "severity", "additional_notes"].some((k) => b[k] !== null && (typeof b[k] !== "string" || b[k].length > 500))) throw new ReportError(400, "INVALID_INPUT", "Enter 1–10 concerns up to 200 characters and optional context up to 500 characters.");
    res.json(await gateway.symptoms(req.user._id, b));
  });
  router.use((e, req, res, next) => e instanceof ReportError ? fail(res, e.status, e.code, e.message) : next(e)); return router;
}
module.exports = { symptomRoutes };
