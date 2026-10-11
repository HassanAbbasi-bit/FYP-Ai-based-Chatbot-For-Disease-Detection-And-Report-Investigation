const express = require("express");
const { pipeline } = require("node:stream/promises");
const { publicReport } = require("../models/Report");
const { ReportError, reportNotFound, storageUnavailable } = require("../services/report-errors");
const { fail } = require("../middleware/errors");
const { csrfSynchronisedProtection, limiter } = require("../middleware/security");
const objectId = /^[a-f\d]{24}$/i;
const uploadId = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function reportRoutes({ reports, limits = {} }) {
  const router = express.Router();
  if (!reports) { router.use((req, res) => fail(res, 503, "STORAGE_UNAVAILABLE", "Private storage is temporarily unavailable.")); return router; }
  const { Report, config } = reports;
  // Auth middleware runs first. Per-user limiter keys are server-derived account IDs.
  const userLimit = (limit, windowMs) => limiter(limit, windowMs, (req) => req.user._id.toString());
  router.use(userLimit(limits.reports || 120, 60000));
  router.use((req, res, next) => ["GET", "HEAD"].includes(req.method) ? next() : csrfSynchronisedProtection(req, res, next));
  router.param("reportId", (req, res, next, id) => {
    if (!objectId.test(id)) return fail(res, 404, "NOT_FOUND", "Report not found.");
    req.reportScope = { _id: id, ownerId: req.user._id }; next();
  });
  router.post("/", userLimit(limits.upload || 10, 15 * 60000), async (req, res) => {
    const id = req.get("x-upload-id");
    if (!id || !uploadId.test(id)) throw new ReportError(400, "INVALID_UPLOAD_ID", "Supply a UUID v4 X-Upload-ID and reuse it when retrying the same file.");
    if (!req.is("multipart/form-data")) throw new ReportError(400, "INVALID_MULTIPART", "Use multipart/form-data with one file field named file.");
    const length = req.get("content-length");
    if (length && Number(length) > config.reportMaxBytes + 65536) throw new ReportError(413, "FILE_TOO_LARGE", "The upload exceeds the configured size limit.");
    const result = await reports.upload(req, req.user._id, id.toLowerCase());
    res.status(result.duplicate ? 200 : 201).json({ report: publicReport(result.report) });
  });
  router.get("/", async (req, res) => {
    if (Object.keys(req.query).some((key) => !["cursor", "limit"].includes(key))) throw new ReportError(400, "INVALID_INPUT", "Only limit and cursor are accepted.");
    const limit = req.query.limit === undefined ? 20 : typeof req.query.limit === "string" && /^\d+$/.test(req.query.limit) ? Number(req.query.limit) : NaN;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new ReportError(400, "INVALID_INPUT", "Limit must be between 1 and 50.");
    const filter = { ownerId: req.user._id };
    if (req.query.cursor !== undefined) {
      try {
        if (typeof req.query.cursor !== "string" || req.query.cursor.length > 200) throw new Error();
        const c = JSON.parse(Buffer.from(req.query.cursor, "base64url").toString());
        if (typeof c.id !== "string" || !objectId.test(c.id) || typeof c.time !== "string" || !Number.isFinite(Date.parse(c.time))) throw new Error();
        filter.$or = [{ createdAt: { $lt: new Date(c.time) } }, { createdAt: new Date(c.time), _id: { $lt: c.id } }];
      } catch { throw new ReportError(400, "INVALID_INPUT", "Invalid pagination cursor."); }
    }
    const rows = await Report.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).lean();
    const page = rows.slice(0, limit), last = page.at(-1);
    res.json({ reports: page.map(publicReport), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ time: last.createdAt.toISOString(), id: last._id.toString() })).toString("base64url") : null,
      limits: { maxBytes: config.reportMaxBytes, maxCount: config.reportMaxCount, maxTotalBytes: config.reportMaxTotalBytes, maxPixels: config.reportMaxPixels } });
  });
  router.get("/:reportId", async (req, res) => {
    const report = await Report.findOne(req.reportScope);
    if (!report) throw reportNotFound();
    res.json({ report: publicReport(report) });
  });
  router.get("/:reportId/file", userLimit(limits.download || 30, 60000), async (req, res) => {
    if (Object.keys(req.query).some((key) => key !== "download") || (req.query.download !== undefined && req.query.download !== "1")) throw new ReportError(400, "INVALID_INPUT", "Only download=1 is accepted.");
    const report = await Report.findOne({ ...req.reportScope, status: "uploaded" }).select("+storageKey");
    if (!report) throw reportNotFound();
    const { handle, size } = await reports.storage.open(report.storageKey);
    if (size !== report.size) { await handle.close(); throw storageUnavailable(); }
    const attachment = report.fileType === "application/pdf" || req.query.download === "1";
    res.set({ "Content-Type": report.fileType, "Content-Length": String(size), "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename="${report.originalFilename}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'", "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer" });
    try { await pipeline(handle.createReadStream(), res); }
    catch { if (!res.headersSent) throw storageUnavailable(); }
    finally { await handle.close().catch(() => {}); }
  });
  router.delete("/:reportId", async (req, res) => {
    if (!req.body || Array.isArray(req.body) || Object.keys(req.body).length) throw new ReportError(400, "INVALID_INPUT", "Delete a report with an empty object.");
    await reports.remove(req.reportScope);
    res.json({ deleted: true });
  });
  router.use((error, req, res, next) => error instanceof ReportError ? fail(res, error.status, error.code, error.message) : next(error));
  return router;
}
module.exports = { reportRoutes };
