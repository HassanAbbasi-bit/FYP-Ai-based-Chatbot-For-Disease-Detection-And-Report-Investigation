const { limitedJson } = require("./extraction-adapters");
const { assertConsent } = require("./consent");
const { ReportError } = require("./report-errors");
function text(v, max = 4000, nullable = false) { if (nullable && v === null) return null; if (typeof v !== "string" || v.length > max) throw new ReportError(502, "INVALID_AI_RESPONSE", "The AI service returned an invalid response."); return v; }
function strings(v, maxCount = 10) { if (!Array.isArray(v) || v.length > maxCount) throw new ReportError(502, "INVALID_AI_RESPONSE", "The AI service returned an invalid response."); return v.map((s) => text(s, 500)); }
function urgency(v) { if (!["low", "moderate", "high", "emergency"].includes(v)) throw new ReportError(502, "INVALID_AI_RESPONSE", "The AI service returned an invalid urgency field."); return v; }
function aiGateway({ config, connection }) {
  let active = 0;
  async function post(ownerId, path, body) {
    if (config.chatProvider !== "fastapi") throw new ReportError(503, "AI_UNAVAILABLE", "The AI service is not connected. Demo chat remains available.");
    await assertConsent(connection, ownerId, "chat");
    if (active >= 2) throw new ReportError(503, "AI_BUSY", "The AI service is busy. Retry explicitly shortly.");
    active++;
    try {
      const signal = AbortSignal.timeout(20000);
      const response = await fetch(`${config.aiServiceUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Key": config.aiInternalKey }, body: JSON.stringify(body), signal, redirect: "error" });
      if (!response.ok) { await response.body?.cancel(); throw new ReportError(502, "AI_SERVICE_ERROR", "The AI service rejected this request. No automatic retry was made."); }
      return await limitedJson(response, signal, 65536);
    } catch (e) { if (e instanceof ReportError) throw e; throw new ReportError(503, "AI_UNAVAILABLE", "The AI service could not complete the request. Provider completion may be unknown; no automatic retry was made."); }
    finally { active--; }
  }
  async function chat({ content, conversationId, ownerId, history }) {
    const data = await post(ownerId, "/api/chat", { message: content, conversation_id: conversationId, history });
    const disclaimer = text(data.disclaimer, 1000);
    if (/development mode/i.test(disclaimer)) throw new ReportError(503, "MODEL_UNAVAILABLE", "The service reported development fallback instead of a live model response. No replacement answer was fabricated.");
    return { mode: "ai", reply: text(data.reply), structured: { origin: "fastapi", urgency: urgency(data.urgency_level), followUps: strings(data.suggested_follow_ups), disclaimer, sources: [], modelVersion: null } };
  }
  async function symptoms(ownerId, body) {
    const data = await post(ownerId, "/api/symptoms/assess", body);
    if (!Array.isArray(data.possible_causes) || data.possible_causes.length > 10 || typeof data.is_red_flag !== "boolean") throw new ReportError(502, "INVALID_AI_RESPONSE", "The service returned an invalid symptom response.");
    return { origin: "fastapi", assessmentId: text(data.assessment_id, 120), urgency: urgency(data.urgency_level), isRedFlag: data.is_red_flag,
      escalation: text(data.escalation_message, 1000, true), possibleCauses: data.possible_causes.map((c) => ({ condition: text(c.condition, 200), likelihood: ["possible", "likely", "unlikely"].includes(c.likelihood) ? c.likelihood : "unspecified", rationale: text(c.rationale, 1000) })),
      questions: strings(data.recommended_questions_for_doctor), selfCare: text(data.self_care_notes, 1000, true), limitations: "Service output; model/fallback provenance and clinical evaluation are not supplied by this endpoint. Possibilities are not diagnoses." };
  }
  return { chat, symptoms };
}
module.exports = { aiGateway, text, strings };
