const mongoose = require("mongoose");
const options = { timestamps: true, strict: "throw", bufferCommands: false };
const conversationSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  title: { type: String, required: true, maxlength: 80, default: "New conversation" },
  reportId: { type: mongoose.Schema.Types.ObjectId, immutable: true },
  reviewVersion: { type: Number, immutable: true },
  nextSequence: { type: Number, required: true, default: 1, min: 1 },
  activeRequestId: { type: String, default: null },
  leaseToken: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
}, options);
conversationSchema.index({ ownerId: 1, updatedAt: -1, _id: -1 });
const messageSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  requestId: { type: String, required: true, maxlength: 36 },
  role: { type: String, enum: ["user", "assistant"], required: true },
  content: { type: String, required: true, maxlength: 4000 },
  sequence: { type: Number, required: true, min: 1 },
  mode: { type: String, enum: ["demo", "ai"], required: true },
  structured: mongoose.Schema.Types.Mixed,
}, { ...options, timestamps: { createdAt: true, updatedAt: false } });
messageSchema.index({ conversationId: 1, sequence: 1 }, { unique: true });
messageSchema.index({ conversationId: 1, requestId: 1, role: 1 }, { unique: true });
const requestSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, required: true, immutable: true },
  requestId: { type: String, required: true, maxlength: 36 },
  content: { type: String, required: true, maxlength: 2000 },
  status: { type: String, enum: ["pending", "completed", "failed"], required: true },
  userSequence: { type: Number, required: true },
  assistantSequence: { type: Number, required: true },
  leaseToken: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  attempts: { type: Number, default: 1 },
}, options);
requestSchema.index({ conversationId: 1, requestId: 1 }, { unique: true });
requestSchema.index({ ownerId: 1, conversationId: 1, status: 1 });

function conversationModels(connection) {
  return {
    Conversation: connection.models.Conversation || connection.model("Conversation", conversationSchema),
    Message: connection.models.Message || connection.model("Message", messageSchema),
    ChatRequest: connection.models.ChatRequest || connection.model("ChatRequest", requestSchema),
  };
}
async function initializeConversations(connection) {
  const hello = await connection.db.admin().command({ hello: 1 });
  if (!hello.setName && hello.msg !== "isdbgrid") {
    const error = new Error("Conversation persistence requires a MongoDB replica set or Atlas cluster; a standalone database cannot safely save or delete conversations.");
    error.code = "REPLICA_SET_REQUIRED";
    throw error;
  }
  await Promise.all(Object.values(conversationModels(connection)).map((model) => model.init()));
  // Exercise a read-only transaction so topology alone is not treated as proof.
  await connection.transaction(async (session) => {
    await connection.models.Conversation.findOne({ _id: new mongoose.Types.ObjectId("000000000000000000000000") }).session(session).lean();
  }, { readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } });
}
const publicConversation = (c) => ({ id: c._id.toString(), title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, ...(c.reportId ? { reportId: String(c.reportId), reviewVersion: c.reviewVersion } : {}) });
const publicMessage = (m) => ({ id: m._id.toString(), conversationId: m.conversationId.toString(), requestId: m.requestId, role: m.role, content: m.content, sequence: m.sequence, mode: m.mode, createdAt: m.createdAt, ...(m.structured ? { structured: m.structured } : {}) });
module.exports = { conversationModels, initializeConversations, publicConversation, publicMessage };
