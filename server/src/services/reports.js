const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { reportModel } = require("../models/Report");
const { LocalReportStorage } = require("./report-storage");
const { ReportError, reportNotFound, storageUnavailable } = require("./report-errors");
const { receiveUpload } = require("./report-upload");
const { validateReport, validateDeclaredType, safeFilename } = require("./report-validation");

async function createReportService({ connection, config, storage = new LocalReportStorage(config.reportStorageDir), hooks = {}, extractionAdapter, extractionAutoRun = true }) {
  const Report = reportModel(connection);
  const User = connection.models.User;
  await Report.init();
  await storage.initialize();
  let cleaning = false;
  let cleanupCompletion;
  let uploadSlots = 0;
  const transaction = async (work) => {
    let result;
    await connection.transaction(async (session) => { result = await work(session); }, { readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
    return result;
  };
  async function releaseMetadata(id) {
    await transaction(async (session) => {
      const record = await Report.findOne({ _id: id, status: "deleting" }).session(session);
      if (!record) return;
      await Report.deleteOne({ _id: record._id, status: "deleting" }, { session });
      if (connection.models.Conversation) {
        const conversations = await connection.models.Conversation.find({ ownerId: record.ownerId, reportId: record._id }).session(session).select('_id').lean();
        const ids = conversations.map(c => c._id);
        for (const name of ['Message','ChatRequest']) await connection.models[name].deleteMany({ ownerId: record.ownerId, conversationId: { $in: ids } }, { session });
        await connection.models.Conversation.deleteMany({ ownerId: record.ownerId, reportId: record._id }, { session });
      }
      for (const name of ["ExtractionJob", "ExtractionResult", "ReportReview", "Analysis", "Feedback"]) {
        if (connection.models[name]) await connection.models[name].deleteMany({ reportId: record._id }, { session });
      }
      await User.updateOne({ _id: record.ownerId }, { $inc: { reportCount: -1, reportBytes: -record.reservedBytes } }, { session });
    });
  }
  async function reserve(ownerId, uploadId) {
    return transaction(async (session) => {
      const existing = await Report.findOne({ ownerId, uploadId }).select("+storageKey +sha256").session(session);
      if (existing) {
        if (existing.status !== "uploaded") throw new ReportError(409, "UPLOAD_IN_PROGRESS", "This upload is incomplete or being deleted. Refresh the library and retry after cleanup.");
        return { report: existing, duplicate: true };
      }
      const quota = await User.updateOne({ _id: ownerId, $expr: { $and: [
        { $lt: [{ $ifNull: ["$reportCount", 0] }, config.reportMaxCount] },
        { $lte: [{ $add: [{ $ifNull: ["$reportBytes", 0] }, config.reportMaxBytes] }, config.reportMaxTotalBytes] },
      ] } }, { $inc: { reportCount: 1, reportBytes: config.reportMaxBytes } }, { session });
      if (!quota.modifiedCount) throw new ReportError(413, "STORAGE_LIMIT", "Your report count or storage limit has been reached. Delete a report before uploading another.");
      const [report] = await Report.create([{ ownerId, uploadId, storageKey: randomUUID(), status: "uploading", reservedBytes: config.reportMaxBytes, leaseUntil: new Date(Date.now() + 5 * 60 * 1000) }], { session });
      return { report, duplicate: false };
    });
  }
  async function finishDeletion(record) {
    await storage.remove(record.storageKey);
    await hooks.afterRemove?.(record);
    await releaseMetadata(record._id);
  }
  async function rollback(record) {
    // A commit may have succeeded even if its response was lost: do not erase uploaded files.
    const pending = await Report.findOneAndUpdate({ _id: record._id, status: "uploading" }, { $set: { status: "deleting", leaseUntil: new Date(0) } }, { returnDocument: "after" }).select("+storageKey");
    if (pending) await finishDeletion(pending);
  }
  async function performUpload(req, ownerId, uploadId) {
    const { report, duplicate } = await reserve(ownerId, uploadId);
    const key = duplicate ? randomUUID() : report.storageKey;
    storage.begin(key);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 120000);
    const abort = () => controller.abort();
    req.once("aborted", abort);
    try {
      const incoming = await receiveUpload(req, storage, key, config.reportMaxBytes, controller.signal);
      const detected = await validateReport(storage.location(key, true), config, controller.signal);
      const filename = safeFilename(incoming.filename);
      validateDeclaredType(filename, incoming.mimeType, detected.fileType);
      if (controller.signal.aborted) throw new ReportError(408, "UPLOAD_ABORTED", "Upload cancelled or timed out. Retry the selected file.");
      if (duplicate) {
        if (incoming.sha256 !== report.sha256) throw new ReportError(409, "UPLOAD_ID_REUSED", "This upload ID was used for a different file. Select a new file to start a new upload.");
        const current = await Report.findOne({ _id: report._id, ownerId, status: "uploaded" });
        if (!current) throw reportNotFound();
        return { report: current, duplicate: true };
      }
      await hooks.beforePublish?.(report);
      await storage.publish(key);
      await hooks.afterPublish?.(report);
      const completed = await transaction(async (session) => {
        const updated = await Report.findOneAndUpdate({ _id: report._id, ownerId, status: "uploading" }, { $set: { displayName: filename, originalFilename: filename, fileType: detected.fileType,
          size: incoming.size, reservedBytes: incoming.size, sha256: incoming.sha256, status: "uploaded", leaseUntil: new Date(0) } }, { returnDocument: "after", runValidators: true, session });
        if (!updated) throw reportNotFound();
        await User.updateOne({ _id: ownerId }, { $inc: { reportBytes: incoming.size - config.reportMaxBytes } }, { session });
        return updated;
      });
      return { report: completed, duplicate: false };
    } catch (error) {
      if (!duplicate) {
        try { await rollback(report); } catch { /* Durable metadata holds the key for bounded reconciliation after recovery. */ }
      }
      throw error instanceof ReportError || /^Mongo|Mongoose/.test(error.name || "") ? error : storageUnavailable();
    } finally {
      clearTimeout(timer); req.removeListener("aborted", abort);
      // Duplicate requests only use this unreferenced temporary key.
      if (duplicate) await storage.remove(key).catch(() => {});
      storage.end(key);
    }
  }
  async function upload(req, ownerId, uploadId) {
    if (uploadSlots >= 2) throw new ReportError(503, "UPLOAD_BUSY", "The upload service is busy. Keep the selected file and retry shortly.");
    uploadSlots++;
    try { return await performUpload(req, ownerId, uploadId); }
    finally { uploadSlots--; }
  }
  async function remove(scope) {
    const report = await Report.findOne(scope).select("+storageKey");
    if (!report) throw reportNotFound();
    if (!storage.begin(report.storageKey)) throw new ReportError(409, "REPORT_BUSY", "The report is still uploading. Wait before deleting it.");
    try {
      const deleting = await Report.findOneAndUpdate(scope, { $set: { status: "deleting", leaseUntil: new Date(0) } }, { returnDocument: "after" }).select("+storageKey");
      if (!deleting) throw reportNotFound();
      await extractions.abortReport(deleting._id);
      await finishDeletion(deleting);
    } catch (error) {
      throw error instanceof ReportError || /^Mongo|Mongoose/.test(error.name || "") ? error : storageUnavailable();
    } finally { storage.end(report.storageKey); }
  }
  async function cleanup({ now = new Date(), limit = 100 } = {}) {
    if (cleaning) return { skipped: true };
    cleaning = true;
    let resolveCleanup;
    cleanupCompletion = new Promise((resolve) => { resolveCleanup = resolve; });
    let removed = 0;
    try {
      const stale = await Report.find({ status: { $in: ["uploading", "deleting"] }, leaseUntil: { $lt: now } }).select("+storageKey").limit(Math.min(limit, 100));
      for (const record of stale) {
        if (!storage.begin(record.storageKey)) continue;
        try {
          const claimed = await Report.findOneAndUpdate({ _id: record._id, status: record.status, leaseUntil: { $lt: now } }, { $set: { status: "deleting" } }, { returnDocument: "after" }).select("+storageKey");
          if (claimed) { await finishDeletion(claimed); removed++; }
        } finally { storage.end(record.storageKey); }
      }
      for (const entry of await storage.scan(Math.min(limit, 100))) {
        if (storage.active.has(entry.key)) continue;
        const filename = storage.location(entry.key, entry.name.endsWith(".part"));
        let stat;
        try { stat = await fs.stat(filename); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
        if (stat.mtimeMs > now.getTime() - 15 * 60 * 1000) continue;
        if (!await Report.exists({ storageKey: entry.key })) { await storage.remove(entry.key); removed++; }
      }
      return { removed };
    } finally { cleaning = false; resolveCleanup(); }
  }
  const cleanupTimer = setInterval(() => cleanup().catch(() => {}), 60000);
  cleanupTimer.unref();
  const { createExtractionService } = require("./extractions");
  let extractions;
  try { extractions = await createExtractionService({ connection, reports: { Report, storage, upload, config }, adapter: extractionAdapter, autoRun: extractionAutoRun }); }
  catch (error) { clearInterval(cleanupTimer); await storage.close(); throw error; }
  const analyses = await require('./analysis').createAnalysisService({ connection, reports: { Report, config }, autoRun: extractionAutoRun });
  connection.fypReportDemo = config.extractionDemoEnabled && !config.production;
  async function close() { clearInterval(cleanupTimer); await analyses.close(); await extractions.close(); await cleanupCompletion; await storage.close(); }
  return { Report, storage, upload, remove, cleanup, close, config, extractions, analyses };
}
module.exports = { createReportService };
