const { randomUUID } = require("node:crypto");
const { conversationModels, publicConversation, publicMessage } = require("../models/Conversation");
const { createDemoReply } = require("./chat");

class ConversationError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const notFound = () => new ConversationError(404, "NOT_FOUND", "Conversation not found.");
function conversationService(connection, { generateReply = createDemoReply, leaseMs = 30000 } = {}) {
  const { Conversation, Message, ChatRequest } = conversationModels(connection);
  const transaction = async (work) => {
    let result;
    await connection.transaction(async (session) => { result = await work(session); }, {
      readPreference: "primary", readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
    });
    return result;
  };
  async function resultFor(scope, requestId, session) {
    const conversation = await Conversation.findOne(scope).session(session).lean();
    if (!conversation) throw notFound();
    const messages = await Message.find({ ownerId: scope.ownerId, conversationId: scope._id, requestId }).sort({ sequence: 1 }).session(session).lean();
    return { status: "completed", requestId, conversation: publicConversation(conversation), messages: messages.map(publicMessage) };
  }
  async function reserve(scope, requestId, content) {
    return transaction(async (session) => {
      const conversation = await Conversation.findOne(scope).session(session);
      if (!conversation) throw notFound();
      const jobScope = { ownerId: scope.ownerId, conversationId: scope._id, requestId };
      let job = await ChatRequest.findOne(jobScope).session(session);
      if (job && job.content !== content) throw new ConversationError(409, "REQUEST_ID_REUSED", "This request ID was already used for different message text. Retry the original message.");
      if (job?.status === "completed") return { result: await resultFor(scope, requestId, session) };
      if (conversation.activeRequestId && conversation.activeRequestId !== requestId) {
        throw new ConversationError(409, "CONVERSATION_BUSY", "An earlier message needs to finish. Reopen this conversation and retry that message first.");
      }
      if (job?.status === "pending" && job.leaseUntil > new Date()) return { result: { status: "pending", requestId, retryAfterMs: 1000 } };
      const token = randomUUID();
      const until = new Date(Date.now() + leaseMs);
      const first = !job;
      const sequence = first ? conversation.nextSequence : job.userSequence;
      conversation.activeRequestId = requestId;
      conversation.leaseToken = token;
      conversation.leaseUntil = until;
      if (first) {
        conversation.nextSequence += 2;
        if (sequence === 1 && conversation.title === "New conversation") conversation.title = content.replace(/\s+/g, " ").trim().slice(0, 60);
      }
      await conversation.save({ session }); // Serializes competing reservations in MongoDB.
      if (first) {
        [job] = await ChatRequest.create([{ ...jobScope, content, status: "pending", userSequence: sequence, assistantSequence: sequence + 1, leaseToken: token, leaseUntil: until }], { session });
        await Message.create([{ ...jobScope, role: "user", content, sequence, mode: "demo" }], { session });
      } else {
        job.status = "pending"; job.leaseToken = token; job.leaseUntil = until; job.attempts += 1;
        await job.save({ session });
      }
      return { token, assistantSequence: job.assistantSequence };
    });
  }
  async function submit(scope, requestId, content) {
    const reservation = await reserve(scope, requestId, content);
    if (reservation.result) return reservation.result;
    const jobScope = { ownerId: scope.ownerId, conversationId: scope._id, requestId, leaseToken: reservation.token, status: "pending" };
    let reply;
    try {
      // No external service is called. Future adapters must respect this lifecycle.
      reply = await generateReply({ content, conversationId: scope._id.toString(), requestId });
      if (reply?.mode !== "demo" || typeof reply.reply !== "string" || !reply.reply.trim() || reply.reply.length > 4000) throw new Error("Invalid demo reply");
    } catch {
      await transaction(async (session) => {
        const conversation = await Conversation.findOne({ ...scope, activeRequestId: requestId, leaseToken: reservation.token }).session(session);
        if (!conversation) return;
        conversation.leaseToken = null; conversation.leaseUntil = null;
        await conversation.save({ session });
        await ChatRequest.updateOne(jobScope, { $set: { status: "failed", leaseToken: null, leaseUntil: null } }, { session });
      });
      throw new ConversationError(503, "REPLY_FAILED", "The reply could not be completed. Your message was saved; retry the same message.");
    }
    return transaction(async (session) => {
      const conversation = await Conversation.findOne(scope).session(session);
      if (!conversation) throw notFound();
      const job = await ChatRequest.findOne(jobScope).session(session);
      if (!job || conversation.leaseToken !== reservation.token || conversation.activeRequestId !== requestId) {
        const finished = await ChatRequest.findOne({ ownerId: scope.ownerId, conversationId: scope._id, requestId, status: "completed" }).session(session);
        if (finished) return resultFor(scope, requestId, session);
        return { status: "pending", requestId, retryAfterMs: 1000 };
      }
      conversation.activeRequestId = null; conversation.leaseToken = null; conversation.leaseUntil = null;
      await conversation.save({ session }); // Conflicts with deletion/recovery before publishing.
      await Message.create([{ ownerId: scope.ownerId, conversationId: scope._id, requestId, role: "assistant", content: reply.reply, mode: reply.mode, sequence: reservation.assistantSequence }], { session });
      job.status = "completed"; job.leaseToken = null; job.leaseUntil = null;
      await job.save({ session });
      return resultFor(scope, requestId, session);
    });
  }
  async function remove(scope) {
    await transaction(async (session) => {
      const deleted = await Conversation.deleteOne(scope, { session });
      if (!deleted.deletedCount) throw notFound();
      await Message.deleteMany({ ownerId: scope.ownerId, conversationId: scope._id }, { session });
      await ChatRequest.deleteMany({ ownerId: scope.ownerId, conversationId: scope._id }, { session });
    });
  }
  return { submit, remove, transaction };
}
module.exports = { conversationService, ConversationError, notFound };
