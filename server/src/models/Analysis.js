const mongoose = require('mongoose');
function analysisModel(connection) {
  const schema = new mongoose.Schema({
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true }, reportId: { type: mongoose.Schema.Types.ObjectId, required: true },
    reviewId: { type: mongoose.Schema.Types.ObjectId, required: true }, reviewVersion: { type: Number, required: true },
    resultId: { type: mongoose.Schema.Types.ObjectId, required: true }, requestId: { type: String, required: true },
    state: { type: String, enum: ['queued','running','succeeded','failed','cancelled'], required: true },
    origin: { type: String, enum: ['synthetic-demo','fastapi'], required: true },
    leaseToken: String, leaseUntil: Date, completedAt: Date, errorCode: String,
    providerStartedAt: Date, inputRowCount: Number,
    modelVersion: { type: String, default: null }, promptVersion: { type: String, default: null },
    output: mongoose.Schema.Types.Mixed,
  }, { timestamps: true, strict: 'throw', bufferCommands: false });
  schema.index({ ownerId: 1, reportId: 1, requestId: 1 }, { unique: true });
  schema.index({ state: 1, leaseUntil: 1 });
  return connection.models.Analysis || connection.model('Analysis', schema);
}
function publicAnalysis(a, report) {
  return { id: String(a._id), reportId: String(a.reportId), reviewId: String(a.reviewId), reviewVersion: a.reviewVersion,
    requestId: a.requestId, state: a.state, origin: a.origin, createdAt: a.createdAt, generatedAt: a.completedAt || null,
    modelVersion: a.modelVersion, promptVersion: a.promptVersion, output: a.output || null, errorCode: a.errorCode || null,
    providerStartedAt: a.providerStartedAt || null, inputRowCount: a.inputRowCount ?? null,
    deadlineAt: a.leaseUntil ? new Date(new Date(a.leaseUntil).getTime() - 30000).toISOString() : null,
    outdated: !report || report.reviewVersion !== a.reviewVersion || String(report.currentResultId) !== String(a.resultId) };
}
module.exports = { analysisModel, publicAnalysis };
