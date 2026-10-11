const express = require("express");
const { conversationModels, publicConversation, publicMessage } = require("../models/Conversation");
const { conversationService, ConversationError, notFound } = require("../services/conversations");
const { csrfSynchronisedProtection, limiter } = require("../middleware/security");
const { fail } = require("../middleware/errors");
const idPattern = /^[a-f\d]{24}$/i;
const uuidPattern = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const only = (body, keys) => body && !Array.isArray(body) && typeof body === "object" && Object.keys(body).every((key) => keys.includes(key));
const invalid = (message) => new ConversationError(400, "INVALID_INPUT", message);
function pagination(query, kind) {
  if (Object.keys(query).some((key) => !["limit", "cursor"].includes(key))) throw invalid("Only limit and cursor are accepted.");
  const limit = query.limit === undefined ? 20 : typeof query.limit === "string" && /^\d+$/.test(query.limit) ? Number(query.limit) : NaN;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw invalid("Limit must be between 1 and 50.");
  let cursor;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || query.cursor.length > 200) throw invalid("Invalid pagination cursor.");
    if (kind === "messages") {
      cursor = Number(query.cursor);
      if (!/^\d+$/.test(query.cursor) || !Number.isSafeInteger(cursor) || cursor < 1) throw invalid("Invalid pagination cursor.");
    } else {
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, "base64url").toString());
        if (!cursor || typeof cursor.id !== "string" || !idPattern.test(cursor.id) || typeof cursor.time !== "string" || !Number.isFinite(Date.parse(cursor.time))) throw new Error();
      } catch { throw invalid("Invalid pagination cursor."); }
    }
  }
  return { limit, cursor };
}
function conversationRoutes({ connection, limits, generation }) {
  const router = express.Router();
  const { Conversation, Message, ChatRequest } = conversationModels(connection);
  const service = conversationService(connection, generation);
  router.use(limiter(limits.history || 120, 60 * 1000));
  router.use((req, res, next) => ["GET", "HEAD"].includes(req.method) ? next() : csrfSynchronisedProtection(req, res, next));
  router.param("conversationId", (req, res, next, value) => {
    if (!idPattern.test(value)) return fail(res, 404, "NOT_FOUND", "Conversation not found.");
    req.conversationScope = { _id: value, ownerId: req.user._id };
    next();
  });
  router.post("/", limiter(limits.create || 20, 60 * 1000), async (req, res) => {
    if (!only(req.body, ['reportId','reviewVersion'])) throw invalid('Provide an empty object or an owned reportId and reviewVersion.');
    const conversation = await service.transaction(async session => {
      await require('../services/consent').accountFence(connection, req.user._id, session);
      let context = {};
      if (Object.keys(req.body).length) {
        if (!idPattern.test(req.body.reportId || '') || !Number.isInteger(req.body.reviewVersion) || req.body.reviewVersion < 1) throw invalid('Invalid report context.');
        const { report } = await require('../services/report-context').reportContext(connection, req.user._id, req.body.reportId, req.body.reviewVersion, session, true);
        context = { reportId: report._id, reviewVersion: req.body.reviewVersion, title: `Report: ${report.displayName}`.slice(0,80) };
      }
      return (await Conversation.create([{ ownerId: req.user._id, ...context }], { session }))[0];
    });
    res.status(201).json({ conversation: publicConversation(conversation) });
  });
  router.get("/", async (req, res) => {
    const { limit, cursor } = pagination(req.query, "conversations");
    const filter = { ownerId: req.user._id };
    if (cursor) filter.$or = [{ updatedAt: { $lt: new Date(cursor.time) } }, { updatedAt: new Date(cursor.time), _id: { $lt: cursor.id } }];
    const rows = await Conversation.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).lean();
    const page = rows.slice(0, limit), last = page.at(-1);
    res.json({ conversations: page.map(publicConversation), nextCursor: rows.length > limit ? Buffer.from(JSON.stringify({ time: last.updatedAt.toISOString(), id: last._id.toString() })).toString("base64url") : null });
  });
  router.get("/:conversationId/messages", async (req, res) => {
    const { limit, cursor } = pagination(req.query, "messages");
    const data = await service.transaction(async (session) => {
      const c = await Conversation.findOne(req.conversationScope).session(session).lean();
      if (!c) throw notFound();
      const context = c.reportId ? await require('../services/report-context').reportContext(connection, req.user._id, c.reportId, c.reviewVersion, session) : null;
      const filter = { ownerId: req.user._id, conversationId: c._id };
      if (cursor) filter.sequence = { $lt: cursor };
      const rows = await Message.find(filter).sort({ sequence: -1 }).limit(limit + 1).session(session).lean();
      const page = rows.slice(0, limit).reverse();
      const job = c.activeRequestId ? await ChatRequest.findOne({ ownerId: req.user._id, conversationId: c._id, requestId: c.activeRequestId }).session(session).lean() : null;
      return { conversation: publicConversation(c), ...(context ? { reportContext: { reportId: String(c.reportId), reviewVersion: c.reviewVersion, outdated: context.outdated, name: context.report.displayName, realAvailable: false } } : {}), messages: page.map(publicMessage), nextCursor: rows.length > limit ? String(page[0].sequence) : null,
        activeRequest: job ? { requestId: job.requestId, content: job.content, status: job.status === "pending" && job.leaseUntil > new Date() ? "pending" : "failed", retryAfterMs: Math.max(0, (job.leaseUntil?.getTime() || 0) - Date.now()) } : null };
    });
    res.json(data);
  });
  router.post("/:conversationId/messages", limiter(limits.chat || 30, 60 * 1000), async (req, res) => {
    if (!only(req.body, ["message", "requestId"]) || typeof req.body.message !== "string" || !req.body.message.trim() || req.body.message.length > 2000 || typeof req.body.requestId !== "string" || !uuidPattern.test(req.body.requestId)) throw invalid("Provide message text of 1–2,000 characters and a UUID v4 requestId; no other fields are accepted.");
    const result = await service.submit(req.conversationScope, req.body.requestId.toLowerCase(), req.body.message);
    if (result.status === "pending") res.set("Retry-After", "1");
    res.status(result.status === "pending" ? 202 : 200).json(result);
  });
  router.patch("/:conversationId", async (req, res) => {
    if (!only(req.body, ["title"]) || typeof req.body.title !== "string" || !req.body.title.trim() || req.body.title.length > 80) throw invalid("Title must be a non-blank string of at most 80 characters.");
    const c = await Conversation.findOneAndUpdate(req.conversationScope, { $set: { title: req.body.title.trim() } }, { returnDocument: "after", runValidators: true });
    if (!c) throw notFound();
    res.json({ conversation: publicConversation(c) });
  });
  router.delete("/:conversationId", async (req, res) => {
    if (!only(req.body, []) || Object.keys(req.body).length) throw invalid("Delete a conversation with an empty object.");
    await service.remove(req.conversationScope);
    res.json({ deleted: true });
  });
  router.use((error, req, res, next) => error instanceof ConversationError || error instanceof require('../services/report-errors').ReportError ? fail(res, error.status, error.code, error.message) : next(error));
  return router;
}
module.exports = { conversationRoutes };
