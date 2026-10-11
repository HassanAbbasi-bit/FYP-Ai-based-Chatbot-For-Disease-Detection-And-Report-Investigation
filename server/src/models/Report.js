const mongoose = require("mongoose");
const reportSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  uploadId: { type: String, required: true, maxlength: 36, immutable: true },
  displayName: { type: String, required: true, maxlength: 120, default: "Report" },
  originalFilename: { type: String, required: true, maxlength: 120, default: "report" },
  storageKey: { type: String, required: true, immutable: true, select: false },
  fileType: { type: String, enum: ["application/pdf", "image/png", "image/jpeg"] },
  size: { type: Number, default: 0, min: 0 },
  reservedBytes: { type: Number, required: true, min: 0 },
  sha256: { type: String, select: false },
  status: { type: String, enum: ["uploading", "uploaded", "deleting"], required: true },
  leaseUntil: { type: Date, required: true },
}, { timestamps: true, strict: "throw", bufferCommands: false });
reportSchema.index({ ownerId: 1, createdAt: -1, _id: -1 });
reportSchema.index({ ownerId: 1, uploadId: 1 }, { unique: true });
reportSchema.index({ status: 1, leaseUntil: 1 });
function reportModel(connection) { return connection.models.Report || connection.model("Report", reportSchema); }
function publicReport(report) {
  return { id: report._id.toString(), displayName: report.displayName, originalFilename: report.originalFilename,
    fileType: report.fileType || null, size: report.size, status: report.status, createdAt: report.createdAt, updatedAt: report.updatedAt };
}
module.exports = { reportModel, publicReport };
