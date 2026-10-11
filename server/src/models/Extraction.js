const mongoose = require("mongoose");
const options = { timestamps: true, strict: "throw", bufferCommands: false };
function extractionModels(connection) {
  const job = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true }, reportId: { type: mongoose.Schema.Types.ObjectId, required: true },
    requestId: { type: String, required: true }, sequence: { type: Number, required: true },
    state: { type: String, enum: ["queued", "running", "succeeded", "failed", "cancelled"], required: true },
    origin: { type: String, enum: ["synthetic-demo", "fastapi"], required: true },
    sourceHash: { type: String, required: true, select: false }, sourceVersion: { type: Number, default: 1 },
    expectedReviewVersion: { type: Number, required: true }, leaseToken: String, leaseUntil: Date,
    startedAt: Date, completedAt: Date, errorCode: String, errorMessage: String,
    cancellation: { type: String, enum: ["not-requested", "local-only", "demo-stopped"], default: "not-requested" },
    resultId: mongoose.Schema.Types.ObjectId,
  }, options);
  job.index({ ownerId: 1, reportId: 1, requestId: 1 }, { unique: true });
  job.index({ reportId: 1, sequence: 1 }, { unique: true });
  job.index({ state: 1, leaseUntil: 1 });
  const result = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true }, reportId: { type: mongoose.Schema.Types.ObjectId, required: true },
    jobId: { type: mongoose.Schema.Types.ObjectId, required: true }, extractionRevision: { type: Number, required: true },
    origin: { type: String, enum: ["synthetic-demo", "fastapi"], required: true },
    sourceHash: { type: String, required: true, select: false }, sourceVersion: { type: Number, default: 1 },
    providerReportId: String, extractorVersion: String,
    originalRows: { type: [mongoose.Schema.Types.Mixed], required: true, immutable: true },
  }, options);
  result.index({ reportId: 1, extractionRevision: 1 }, { unique: true });
  result.index({ jobId: 1 }, { unique: true });
  const review = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true }, reportId: { type: mongoose.Schema.Types.ObjectId, required: true },
    resultId: { type: mongoose.Schema.Types.ObjectId, required: true }, version: { type: Number, required: true },
    rows: { type: [mongoose.Schema.Types.Mixed], required: true },
    status: { type: String, enum: ["draft", "reviewed", "outdated"], required: true },
    editorId: { type: mongoose.Schema.Types.ObjectId, required: true }, reviewedAt: Date,
  }, options);
  review.index({ reportId: 1, version: 1 }, { unique: true });
  return {
    ExtractionJob: connection.models.ExtractionJob || connection.model("ExtractionJob", job),
    ExtractionResult: connection.models.ExtractionResult || connection.model("ExtractionResult", result),
    ReportReview: connection.models.ReportReview || connection.model("ReportReview", review),
  };
}
function publicJob(job) {
  if (!job) return null;
  return { id: String(job._id), reportId: String(job.reportId), sequence: job.sequence, state: job.state, origin: job.origin,
    createdAt: job.createdAt, startedAt: job.startedAt || null, completedAt: job.completedAt || null,
    error: job.errorCode ? { code: job.errorCode, message: job.errorMessage } : null, cancellation: job.cancellation,
    resultId: job.resultId ? String(job.resultId) : null };
}
module.exports = { extractionModels, publicJob };
