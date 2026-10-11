const { randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const { Readable } = require("node:stream");
const { extractionModels, publicJob } = require("../models/Extraction");
const { ReportError, reportNotFound } = require("./report-errors");
const { corrections } = require("./extraction-data");
const { createAdapter } = require("./extraction-adapters");
const { sample } = require("./extraction-sample");
const conflict = () => new ReportError(409, "REVISION_CONFLICT", "This report changed in another tab or extraction. Reload the saved revision before reconciling your edits.");
async function createExtractionService({ connection, reports, adapter, autoRun = true }) {
  const { Report, storage, config } = reports;
  const { ExtractionJob: Job, ExtractionResult: Result, ReportReview: Review } = extractionModels(connection);
  await Promise.all([Job.init(), Result.init(), Review.init()]);
  const generate = adapter || createAdapter(config, storage);
  const running = new Map(); let stopped = false, pumping = false, pendingPump;
  async function transaction(work) { let value; await connection.transaction(async (session) => { value = await work(session); }, { readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }); return value; }
  async function owned(scope, session) { const query = Report.findOne({ ...scope, status: "uploaded" }).select("+storageKey +sha256 +sampleVersion"); if (session) query.session(session); const report = await query; if (!report) throw reportNotFound(); return report; }
  function availability(report) {
    if (config.extractionDemoEnabled && report.sampleVersion === "synthetic-v1") return "synthetic-demo";
    return config.extractionProvider === "fastapi" ? "fastapi" : null;
  }
  async function start(scope, requestId, expectedVersion) {
    const job = await transaction(async (session) => {
      const report = await owned(scope, session);
      const previous = await Job.findOne({ reportId: report._id, ownerId: scope.ownerId, requestId }).session(session);
      if (previous) return previous;
      const origin = availability(report);
      if (!origin) throw new ReportError(503, "EXTRACTION_UNAVAILABLE", "Extraction service not connected. Use the dedicated sample when demo extraction is enabled.");
      if (report.activeExtractionId) throw new ReportError(409, "EXTRACTION_IN_PROGRESS", "An extraction attempt is already queued or running. Refresh its status.");
      if ((report.reviewVersion || 0) !== expectedVersion) throw conflict();
      if ((report.extractionSequence || 0) >= 20) throw new ReportError(429, "ATTEMPT_LIMIT", "This report reached its 20-attempt limit.");
      const id = new mongoose.Types.ObjectId(), sequence = (report.extractionSequence || 0) + 1;
      await Report.updateOne({ _id: report._id, status: "uploaded" }, { $set: { activeExtractionId: id, extractionSequence: sequence } }, { session });
      const [created] = await Job.create([{ _id: id, reportId: report._id, ownerId: scope.ownerId, requestId, sequence, state: "queued", origin, sourceHash: report.sha256,
        expectedReviewVersion: expectedVersion, leaseUntil: new Date(Date.now() + 90000) }], { session });
      return created;
    });
    if (autoRun) kick();
    return publicJob(job);
  }
  async function finish(id, token, { data, error, state = "failed" }) {
    await transaction(async (session) => {
      const job = await Job.findOne({ _id: id, state: "running", leaseToken: token }).select("+sourceHash").session(session);
      if (!job) return;
      const report = await Report.findOne({ _id: job.reportId, ownerId: job.ownerId, status: "uploaded", activeExtractionId: id }).select("+sha256").session(session);
      if (!report) return;
      if ((report.reviewVersion || 0) !== job.expectedReviewVersion || report.sha256 !== job.sourceHash) { data = null; error = conflict(); }
      if (data) {
        // Validate every adapter, including test/demo adapters, before persisting untrusted values.
        if (!data.rows || JSON.stringify(data).length > 262144) throw new ReportError(502, "INVALID_PROVIDER_RESULT", "The extraction service returned an invalid or oversized result.");
        const editableRows = data.rows.map(({ id: rowId, testName, rawValue, units, referenceRange, reportDate, sourcePage, unknown, unreadable }) => ({ id: rowId, testName, rawValue, units, referenceRange, reportDate, sourcePage, unknown, unreadable, removed: false }));
        const validated = corrections(editableRows, []);
        const originalRows = validated.map((row, i) => ({ ...row, provenance: "extracted", uncertain: Boolean(data.rows[i].uncertain), reviewReason: typeof data.rows[i].reviewReason === "string" ? data.rows[i].reviewReason.slice(0, 300) : null, confidence: null }));
        const [result] = await Result.create([{ ownerId: job.ownerId, reportId: report._id, jobId: id, extractionRevision: job.sequence, origin: job.origin, sourceHash: job.sourceHash,
          providerReportId: typeof data.providerReportId === "string" ? data.providerReportId.slice(0, 120) : undefined, originalRows }], { session });
        const version = (report.reviewVersion || 0) + 1;
        await Review.create([{ ownerId: job.ownerId, reportId: report._id, resultId: result._id, version, rows: originalRows, status: "draft", editorId: job.ownerId }], { session });
        await Report.updateOne({ _id: report._id }, { $set: { currentResultId: result._id, reviewVersion: version }, $unset: { activeExtractionId: 1 } }, { session });
        await Job.updateOne({ _id: id }, { $set: { state: "succeeded", resultId: result._id, completedAt: new Date() }, $unset: { leaseToken: 1, leaseUntil: 1 } }, { session });
      } else {
        await Report.updateOne({ _id: report._id }, { $unset: { activeExtractionId: 1 } }, { session });
        const code = error instanceof ReportError ? error.code : "EXTRACTION_FAILED";
        const message = error instanceof ReportError ? error.message : "Extraction failed. The original report is unchanged. Retry explicitly after checking the service.";
        await Job.updateOne({ _id: id }, { $set: { state, errorCode: code, errorMessage: message, completedAt: new Date() }, $unset: { leaseToken: 1, leaseUntil: 1 } }, { session });
      }
    });
  }
  async function run(job) {
    const controller = new AbortController(), token = randomUUID();
    const work = (async () => {
      const claimed = await Job.findOneAndUpdate({ _id: job._id, state: "queued" }, { $set: { state: "running", leaseToken: token, startedAt: new Date(), leaseUntil: new Date(Date.now() + 90000) } }, { returnDocument: "after" }).select("+sourceHash");
      if (!claimed) return;
      let timer;
      try {
        const report = await owned({ _id: claimed.reportId, ownerId: claimed.ownerId });
        const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { reject(new ReportError(504, "EXTRACTION_TIMEOUT", "Extraction timed out. Provider work may still continue; retry only after checking its status.")); controller.abort(); }, config.extractionTimeoutMs); });
        const cancelled = new Promise((resolve, reject) => { controller.signal.addEventListener("abort", () => reject(new ReportError(409, "EXTRACTION_CANCELLED", "Extraction was cancelled locally.")), { once: true }); });
        const data = await Promise.race([generate({ report, origin: claimed.origin, signal: controller.signal }), timeout, cancelled]);
        await finish(claimed._id, token, { data });
      } catch (error) {
        try { await finish(claimed._id, token, { error }); } catch { /* Lease recovery resolves database outages; no health values are logged. */ }
      } finally { clearTimeout(timer); }
    })().finally(() => running.delete(String(job._id)));
    running.set(String(job._id), { controller, work });
    await work;
  }
  async function recover(now = new Date()) {
    const stale = await Job.find({ state: { $in: ["queued", "running"] }, leaseUntil: { $lt: now } }).limit(100);
    for (const candidate of stale) {
      await transaction(async (session) => {
        const changed = await Job.findOneAndUpdate({ _id: candidate._id, state: candidate.state, leaseUntil: { $lt: now } }, { $set: { state: "failed", errorCode: "INTERRUPTED", errorMessage: "Extraction was interrupted. Provider completion is unknown; retry explicitly.", completedAt: new Date() }, $unset: { leaseToken: 1, leaseUntil: 1 } }, { session, returnDocument: "after" });
        if (changed) await Report.updateOne({ _id: changed.reportId, activeExtractionId: changed._id }, { $unset: { activeExtractionId: 1 } }, { session });
      });
      running.get(String(candidate._id))?.controller.abort();
    }
  }
  async function pump() {
    if (stopped || pumping) return;
    pumping = true;
    try {
      await recover();
      if (running.size >= 2) return;
      const queued = await Job.find({ state: "queued" }).sort({ createdAt: 1 }).limit(Math.max(0, 2 - running.size));
      // Mongoose limit(0) is unlimited: never query or dispatch with no free slots.
      if (running.size >= 2) return;
      for (const job of queued) { if (running.size >= 2 || stopped) break; void run(job).catch(() => {}); }
    } finally { pumping = false; }
  }
  function kick() { pendingPump = pump().catch(() => {}); }
  const timer = autoRun ? setInterval(kick, 1000) : null;
  timer?.unref();
  async function read(scope) {
    const report = await owned(scope);
    const jobs = await Job.find({ reportId: report._id, ownerId: scope.ownerId }).sort({ sequence: -1 }).limit(20);
    let result = null, review = null;
    if (report.currentResultId) {
      const original = await Result.findOne({ _id: report.currentResultId, ownerId: scope.ownerId }).lean();
      const current = await Review.findOne({ reportId: report._id, ownerId: scope.ownerId, version: report.reviewVersion }).lean();
      if (original && current) {
        result = { id: String(original._id), extractionRevision: original.extractionRevision, origin: original.origin, sourceVersion: original.sourceVersion, originalRows: original.originalRows };
        review = { id: String(current._id), version: current.version, status: current.status, rows: current.rows, editorId: String(current.editorId), updatedAt: current.updatedAt, reviewedAt: current.reviewedAt || null };
      }
    }
    return { available: availability(report), demoEnabled: config.extractionDemoEnabled, job: publicJob(jobs[0]), attempts: jobs.map(publicJob), result, review, reviewVersion: report.reviewVersion || 0 };
  }
  async function save(scope, { resultId, expectedVersion, rows, markReviewed }) {
    return transaction(async (session) => {
      const report = await owned(scope, session);
      if (String(report.currentResultId) !== resultId || (report.reviewVersion || 0) !== expectedVersion) throw conflict();
      if (expectedVersion >= 200) throw new ReportError(429, "REVIEW_LIMIT", "This report reached its 200-review-revision limit.");
      const result = await Result.findOne({ _id: resultId, reportId: report._id, ownerId: scope.ownerId }).session(session);
      const previous = await Review.findOne({ reportId: report._id, version: expectedVersion }).session(session);
      if (!result || !previous) throw reportNotFound();
      const clean = corrections(rows, result.originalRows);
      const status = markReviewed ? "reviewed" : ["reviewed", "outdated"].includes(previous.status) ? "outdated" : "draft";
      const version = expectedVersion + 1;
      const [review] = await Review.create([{ ownerId: scope.ownerId, reportId: report._id, resultId, version, rows: clean, status, editorId: scope.ownerId, ...(markReviewed ? { reviewedAt: new Date() } : {}) }], { session });
      await Report.updateOne({ _id: report._id, status: "uploaded" }, { $set: { reviewVersion: version } }, { session });
      return { version: review.version, status: review.status };
    });
  }
  async function cancel(scope, id) {
    await transaction(async (session) => {
      const report = await owned(scope, session);
      const job = await Job.findOne({ _id: id, reportId: report._id, ownerId: scope.ownerId }).session(session);
      if (!job) throw reportNotFound();
      if (!["queued", "running"].includes(job.state)) return;
      await Job.updateOne({ _id: id }, { $set: { state: "cancelled", completedAt: new Date(), cancellation: job.origin === "synthetic-demo" ? "demo-stopped" : "local-only" }, $unset: { leaseToken: 1, leaseUntil: 1 } }, { session });
      await Report.updateOne({ _id: report._id, activeExtractionId: job._id }, { $unset: { activeExtractionId: 1 } }, { session });
    });
    running.get(id)?.controller.abort();
  }
  async function createSample(ownerId, uploadId) {
    if (!config.extractionDemoEnabled) throw new ReportError(503, "DEMO_DISABLED", "Synthetic sample extraction is not enabled on this server.");
    const { bytes } = await sample(), boundary = "sample-" + randomUUID();
    const request = Readable.from([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="synthetic-review-sample.png"\r\nContent-Type: image/png\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    request.headers = { "content-type": `multipart/form-data; boundary=${boundary}` };
    const uploaded = await reports.upload(request, ownerId, uploadId);
    const report = await Report.findOneAndUpdate({ _id: uploaded.report._id, ownerId, status: "uploaded" }, { $set: { sampleVersion: "synthetic-v1" } }, { returnDocument: "after" });
    if (!report) throw reportNotFound();
    return report;
  }
  async function close() { stopped = true; if (timer) clearInterval(timer); await pendingPump; for (const item of running.values()) item.controller.abort(); await Promise.allSettled([...running.values()].map((item) => item.work)); }
  return { start, read, save, cancel, recover, pump, run, createSample, close, abortReport: async (reportId) => { const jobs = await Job.find({ reportId, state: { $in: ["queued", "running"] } }); for (const job of jobs) running.get(String(job._id))?.controller.abort(); }, Job, Result, Review };
}
module.exports = { createExtractionService };
