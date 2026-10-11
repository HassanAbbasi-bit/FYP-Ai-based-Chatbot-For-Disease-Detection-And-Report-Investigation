const { test } = require("node:test");
const assert = require("node:assert/strict");
const { aiGateway } = require("../src/services/ai-gateway");
test("configured chat validates structured urgency and sends bounded owner context without profile", async () => {
  const previous = global.fetch; let body;
  global.fetch = async (url, options) => { body = JSON.parse(options.body); assert.equal(url, "http://127.0.0.1:8000/api/chat"); assert.equal(options.headers["X-Internal-Key"], "synthetic-key"); return new Response(JSON.stringify({ reply: "Synthetic answer", suggested_follow_ups: ["Synthetic question"], urgency_level: "emergency", disclaimer: "Synthetic stub only" }), { headers: { "content-type": "application/json" } }); };
  try { const g = aiGateway({ config: { chatProvider: "fastapi", aiServiceUrl: "http://127.0.0.1:8000", aiInternalKey: "synthetic-key" }, connection: { models: { User: { exists: async () => true } } } }); const r = await g.chat({ content: "synthetic", conversationId: "owned", ownerId: "owner", history: [] }); assert.equal(r.structured.urgency, "emergency"); assert.equal(r.mode, "ai"); assert.equal(body.patient_context, undefined); }
  finally { global.fetch = previous; }
});
test("configured chat rejects development fallback and does not fake successful output", async () => {
  const previous = global.fetch; global.fetch = async () => new Response(JSON.stringify({ reply: "fallback", suggested_follow_ups: [], urgency_level: "low", disclaimer: "Development Mode: not connected" }), { headers: { "content-type": "application/json" } });
  try { const g = aiGateway({ config: { chatProvider: "fastapi", aiServiceUrl: "http://127.0.0.1:8000" }, connection: { models: { User: { exists: async () => true } } } }); await assert.rejects(g.chat({ history: [] }), (e) => e.code === "MODEL_UNAVAILABLE"); } finally { global.fetch = previous; }
});
