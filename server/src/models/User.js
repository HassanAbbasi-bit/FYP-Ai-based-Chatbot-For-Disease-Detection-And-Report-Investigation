const mongoose = require("mongoose");
const validator = require("validator");
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true, validate: validator.isEmail },
  passwordHash: { type: String, required: true, select: false },
  reportCount: { type: Number, default: 0, min: 0, select: false },
  reportBytes: { type: Number, default: 0, min: 0, select: false },
  healthContext: { medications: { type: String, default: null, maxlength: 500 }, allergies: { type: String, default: null, maxlength: 500 }, conditions: { type: String, default: null, maxlength: 500 } },
  consent: { noticeVersion: { type: String, default: "fyp-ai-v1" }, chat: { type: Boolean, default: false }, reports: { type: Boolean, default: false }, profile: { type: Boolean, default: false }, decidedAt: Date },
  privacyVersion: { type: Number, default: 0 },
  contextFence: { type: Number, default: 0, select: false },
  deletionState: { type: String, enum: ["active", "pending"], default: "active" },
}, { timestamps: true, strict: "throw", bufferCommands: false });
userSchema.set("toJSON", { transform(doc, value) { delete value.passwordHash; delete value.reportCount; delete value.reportBytes; return value; } });
function publicUser(user) {
  return { id: user._id.toString(), name: user.name, email: user.email, createdAt: user.createdAt, updatedAt: user.updatedAt };
}
module.exports = { userSchema, publicUser };
