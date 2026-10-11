const { randomUUID } = require('node:crypto');
const { analysisModel, publicAnalysis } = require('../models/Analysis');
const { extractionModels } = require('../models/Extraction');
const { ReportError, reportNotFound } = require('./report-errors');
const { accountFence, assertConsent } = require('./consent');
const { sample } = require('./extraction-sample');
const error = (status, code, message) => new ReportError(status, code, message);
async function createAnalysisService({ connection, reports, autoRun = true }) {
  const Analysis = analysisModel(connection), { ReportReview } = extractionModels(connection);
  await Analysis.init();
  let closed = false, polling = false;
  const active = new Set();
  const transaction = async work => { let value; await connection.transaction(async session => { value = await work(session); }); return value; };
  async function scoped(scope, session) {
    const report = await reports.Report.findOne({ ...scope, status: 'uploaded' }).select('+sampleVersion +sha256').session(session);
    if (!report) throw reportNotFound();
    return report;
  }
  async function eligible(report) { return reports.config.extractionDemoEnabled && !reports.config.production && report.sampleVersion === 'synthetic-v1' && report.sha256 === (await sample()).hash; }
  async function start(scope, requestId, reviewVersion) {
    const job = await transaction(async session => {
      const report = await scoped(scope, session);
      await accountFence(connection, scope.ownerId, session);
      await assertConsent(connection, scope.ownerId, 'reports', session);
      const existing = await Analysis.findOne({ ownerId: scope.ownerId, reportId: scope._id, requestId }).session(session);
      if (existing) { if (existing.reviewVersion !== reviewVersion) throw error(409,'REQUEST_ID_REUSED','Retry the original revision with this request ID.'); return existing; }
      if (report.reviewVersion !== reviewVersion) throw error(409,'REVIEW_CHANGED','Reload the latest reviewed revision first.');
      const review = await ReportReview.findOne({ ownerId: scope.ownerId, reportId: scope._id, version: reviewVersion, resultId: report.currentResultId, status: 'reviewed' }).session(session);
      if (!review) throw error(409,'REVIEW_REQUIRED','Save a user-reviewed revision before requesting analysis.');
      if (!await eligible(report)) throw error(503,'ANALYSIS_UNAVAILABLE','Analysis of corrected report data needs the confirmed AI contract. Only the dedicated synthetic sample has a demo.');
      if (await Analysis.countDocuments({ reportId: report._id }).session(session) >= 20) throw error(409,'ATTEMPT_LIMIT','This report has reached its 20 analysis attempts.');
      if (await Analysis.exists({ reportId: report._id, state: { $in: ['queued','running'] } }).session(session)) throw error(409,'ANALYSIS_BUSY','An analysis attempt is already pending.');
      report.analysisFence = (report.analysisFence || 0) + 1; await report.save({ session });
      const [created] = await Analysis.create([{ ownerId: scope.ownerId, reportId: report._id, reviewId: review._id, reviewVersion, resultId: report.currentResultId, requestId, state: 'queued', origin: 'synthetic-demo' }], { session });
      return created;
    });
    if (autoRun) void tick();
    return publicAnalysis(job, await scoped(scope));
  }
  async function run(job) {
    try {
      await transaction(async session => {
        const current = await Analysis.findOne({ _id: job._id, state: 'running', leaseToken: job.leaseToken }).session(session);
        if (!current) return;
        await accountFence(connection, job.ownerId, session); await assertConsent(connection, job.ownerId, 'reports', session);
        const report = await scoped({ _id: job.reportId, ownerId: job.ownerId }, session);
        if (report.reviewVersion !== job.reviewVersion || String(report.currentResultId) !== String(job.resultId)) throw error(409,'REVIEW_CHANGED','Revision changed.');
        if (!await eligible(report)) throw error(503,'ANALYSIS_UNAVAILABLE','Demo unavailable.');
        const review = await ReportReview.findOne({ _id: job.reviewId, ownerId: job.ownerId, status: 'reviewed' }).session(session);
        if (!review) throw error(409,'REVIEW_CHANGED','Review unavailable.');
        report.analysisFence = (report.analysisFence || 0) + 1; await report.save({ session });
        current.output = { rows: review.rows.filter(r => !r.removed).map(r => ({ id: r.id, testName: r.testName, rawValue: r.rawValue, units: r.units, referenceRange: r.referenceRange, reportDate: r.reportDate, unknown: r.unknown, unreadable: r.unreadable, flag: null, explanation: 'Synthetic workflow demonstration: this row copies the saved review. No medical interpretation or range flag was generated.' })),
          sources: [], questions: ['Are these reviewed entries complete and accurate?'], escalation: null,
          limitations: ['DEMO — dedicated synthetic sample only.', 'User-reviewed means checked by the account owner, not clinical validation.', 'No AI model, medical interpretation, diagnosis, approved range flags or source retrieval is connected. Missing values remain unknown.'] };
        current.state = 'succeeded'; current.completedAt = new Date(); current.leaseToken = null; current.leaseUntil = null; await current.save({ session });
      });
    } catch (e) { await Analysis.updateOne({ _id: job._id, state: 'running', leaseToken: job.leaseToken }, { $set: { state: 'failed', completedAt: new Date(), errorCode: e instanceof ReportError ? e.code : 'PROCESSING_FAILED', leaseToken: null, leaseUntil: null } }).catch(() => {}); }
  }
  async function tick() {
    if (closed || polling) return; polling = true;
    try {
      await Analysis.updateMany({ state: 'running', leaseUntil: { $lt: new Date() } }, { $set: { state: 'failed', errorCode: 'INTERRUPTED', completedAt: new Date(), leaseToken: null, leaseUntil: null } });
      while (!closed && active.size < 2) {
        const job = await Analysis.findOneAndUpdate({ state: 'queued' }, { $set: { state: 'running', leaseToken: randomUUID(), leaseUntil: new Date(Date.now()+30000) } }, { sort: { createdAt: 1 }, returnDocument: 'after' });
        if (!job) break;
        const promise = run(job).finally(() => active.delete(promise)); active.add(promise);
      }
    } catch { /* Persisted jobs remain recoverable after a database outage. */ } finally { polling = false; }
  }
  async function read(scope) { const report = await scoped(scope); const jobs = await Analysis.find({ ownerId: scope.ownerId, reportId: scope._id }).sort({ createdAt: -1, _id: -1 }).limit(20).lean(); return { available: await eligible(report), realAvailable: false, analyses: jobs.map(j => publicAnalysis(j, report)) }; }
  async function cancel(scope, id) { await scoped(scope); await Analysis.updateOne({ _id: id, reportId: scope._id, ownerId: scope.ownerId, state: { $in: ['queued','running'] } }, { $set: { state: 'cancelled', completedAt: new Date(), leaseToken: null, leaseUntil: null } }); }
  const timer = autoRun ? setInterval(() => void tick(), 1000) : null; timer?.unref();
  if (autoRun) await tick();
  return { start, read, cancel, tick, Analysis, close: async () => { closed = true; clearInterval(timer); while (polling) await new Promise(r => setTimeout(r,10)); await Promise.allSettled([...active]); } };
}
module.exports = { createAnalysisService };
