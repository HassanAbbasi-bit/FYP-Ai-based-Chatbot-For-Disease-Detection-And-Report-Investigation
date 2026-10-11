const express = require("express");
const { ReportError, reportNotFound } = require("../services/report-errors");
const { publicReport } = require("../models/Report");
const { fail } = require("../middleware/errors");
const { csrfSynchronisedProtection, limiter } = require("../middleware/security");
const id = /^[a-f\d]{24}$/i;
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function extractionRoutes(reports, limits = {}) {
  const router = express.Router();
  if (!reports) { router.use((req, res) => fail(res, 503, "EXTRACTION_UNAVAILABLE", "Extraction service not connected.")); return router; }
  const service = reports.extractions;
  router.use(limiter(limits.extractionReads || 120, 60000, (req) => String(req.user._id)));
  router.use((req, res, next) => ["GET", "HEAD"].includes(req.method) ? next() : csrfSynchronisedProtection(req, res, next));
  const writes = limiter(limits.extractionWrites || 30, 60000, (req) => String(req.user._id));
  const starts = limiter(limits.extractionStarts || 10, 15 * 60000, (req) => String(req.user._id));
  function body(req, keys) {
    if (!req.body || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).some((key) => !keys.includes(key)) || keys.some((key) => !(key in req.body))) throw new ReportError(400, "INVALID_INPUT", "Use the documented extraction request fields.");
    return req.body;
  }
  function version(v) { if (!Number.isInteger(v) || v < 0 || v > 200) throw new ReportError(400, "INVALID_INPUT", "Supply the current review version."); }
  router.post("/sample", starts, async (req, res) => {
    const b = body(req, ["requestId"]); if (typeof b.requestId !== "string" || !uuid.test(b.requestId)) throw new ReportError(400, "INVALID_INPUT", "Supply a UUID v4 requestId.");
    const report = await service.createSample(req.user._id, b.requestId.toLowerCase());
    res.status(201).json({ report: publicReport(report) });
  });
  router.param("reportId", (req, res, next, reportId) => {
    if (!id.test(reportId)) return fail(res, 404, "NOT_FOUND", "Report not found.");
    req.reportScope = { _id: reportId, ownerId: req.user._id }; next();
  });
  router.get("/:reportId/extraction", async (req, res) => res.json(await service.read(req.reportScope)));
  router.post("/:reportId/extraction", starts, async (req, res) => {
    const b = body(req, ["requestId", "expectedVersion"]); if (typeof b.requestId !== "string" || !uuid.test(b.requestId)) throw new ReportError(400, "INVALID_INPUT", "Supply a UUID v4 requestId."); version(b.expectedVersion);
    res.status(202).json({ job: await service.start(req.reportScope, b.requestId.toLowerCase(), b.expectedVersion) });
  });
  router.post("/:reportId/extraction/:jobId/cancel", writes, async (req, res) => {
    body(req, []); if (!id.test(req.params.jobId)) throw reportNotFound();
    await service.cancel(req.reportScope, req.params.jobId); res.json({ cancelledLocally: true, providerCancellationConfirmed: false });
  });
  router.put("/:reportId/review", writes, async (req, res) => {
    const b = body(req, ["resultId", "expectedVersion", "rows", "markReviewed"]);
    if (typeof b.resultId !== "string" || !id.test(b.resultId) || typeof b.markReviewed !== "boolean") throw new ReportError(400, "INVALID_INPUT", "Supply a result ID and explicit review action."); version(b.expectedVersion);
    res.json(await service.save(req.reportScope, b));
  });
  router.use((error, req, res, next) => error instanceof ReportError ? fail(res, error.status, error.code, error.message) : next(error));
  return router;
}
module.exports = { extractionRoutes };
