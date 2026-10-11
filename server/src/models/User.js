const mongoose = require("mongoose");
const validator = require("validator");
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true, validate: validator.isEmail },
  passwordHash: { type: String, required: true, select: false },
  reportCount: { type: Number, default: 0, min: 0, select: false },
  reportBytes: { type: Number, default: 0, min: 0, select: false },
}, { timestamps: true, strict: "throw", bufferCommands: false });
userSchema.set("toJSON", { transform(doc, value) { delete value.passwordHash; delete value.reportCount; delete value.reportBytes; return value; } });
function publicUser(user) {
  return { id: user._id.toString(), name: user.name, email: user.email, createdAt: user.createdAt, updatedAt: user.updatedAt };
}
module.exports = { userSchema, publicUser };
