const { limitedJson } = require("./extraction-adapters");
const { assertConsent } = require("./consent");
const { ReportError } = require("./report-errors");
function text(v, max = 4000, nullable = false) { if (nullable && v === null) return null; if (typeof v !== "string" || v.length > max) throw new ReportError(502, "INVALID_AI_RESPONSE", "The AI service returned an invalid response."); return v; }
function strings(v, maxCount = 10) { if (!Array.isArray(v) || v.length > maxCount) throw new ReportError(502, "INVALID_AI_RESPONSE", "The AI service returned an invalid response."); return v.map((s) => text(s, 500)); }
function urgency(v) { if (!["low", "moderate", "high", "emergency"].includes(v)) throw new ReportError(502, "INVALID_AI_RESPONSE", "The AI service returned an invalid urgency field."); return v; }
function aiGateway({ config, connection }) {
  let active = 0;
  async function post(ownerId, path, body, consent = 'chat') {
    if ((consent === 'chat' ? config.chatProvider : config.extractionProvider) !== "fastapi") throw new ReportError(503, "AI_UNAVAILABLE", "The AI service is not connected.");
    await assertConsent(connection, ownerId, consent);
    if (active >= 2) throw new ReportError(503, "AI_BUSY", "The AI service is busy. Retry explicitly shortly.");
    active++;
    try {
      const signal = AbortSignal.timeout(config.aiRequestTimeoutMs || 485000);
      const response = await fetch(`${config.aiServiceUrl}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Internal-Key": config.aiInternalKey }, body: JSON.stringify(body), signal, redirect: "error" });
      if (response.status===413) {await response.body?.cancel();throw new ReportError(413,'AI_CONTEXT_TOO_LARGE','The reviewed entries or conversation exceed the model context. Shorten entry text or open a new report conversation.');}
      if ([502,504].includes(response.status)) {
        let data;try{data=await limitedJson(response,signal,8192);}catch{await response.body?.cancel().catch(()=>{});}
        const known={INVALID_MODEL_OUTPUT:[502,'The model returned data that did not match the report format. No interpretation was saved.'],MODEL_TIMEOUT:[504,'The model did not finish before its deadline. No automatic retry was made.']};
        const detail=known[data?.detail?.code];if(detail)throw new ReportError(detail[0],data.detail.code,detail[1]);
      }
      if (!response.ok) { await response.body?.cancel(); throw new ReportError(response.status===503?503:502,response.status===503?'MODEL_UNAVAILABLE':'AI_SERVICE_ERROR',response.status===503?'The model could not complete the request. Check Ollama and available memory, then retry.':'The AI service rejected this request. No automatic retry was made.'); }
      return await limitedJson(response, signal, 65536);
    } catch (e) { if (e instanceof ReportError) throw e; throw new ReportError(503, "AI_UNAVAILABLE", "The AI service could not complete the request. Provider completion may be unknown; no automatic retry was made."); }
    finally { active--; }
  }
  async function chat({ content, conversationId, ownerId, history, reportContext }) {
    if (reportContext) await assertConsent(connection,ownerId,'reports');
    const data = await post(ownerId, reportContext ? '/api/reports/reviewed/chat' : "/api/chat", { message: content, conversation_id: conversationId, history, ...(reportContext || {}) });
    const disclaimer = text(data.disclaimer, 1000);
    if (/development mode/i.test(disclaimer)) throw new ReportError(503, "MODEL_UNAVAILABLE", "The service reported development fallback instead of a live model response. No replacement answer was fabricated.");
    return { mode: "ai", reply: text(data.reply), structured: { origin: "fastapi", urgency: urgency(data.urgency_level), followUps: strings(data.suggested_follow_ups), disclaimer, sources: [], modelVersion: null } };
  }
  async function symptoms(ownerId, body) {
    const data = await post(ownerId, "/api/symptoms/assess", body);
    await assertConsent(connection,ownerId,'chat');
    if (!Array.isArray(data.possible_causes) || data.possible_causes.length > 10 || typeof data.is_red_flag !== "boolean") throw new ReportError(502, "INVALID_AI_RESPONSE", "The service returned an invalid symptom response.");
    return { origin: data.origin === 'ollama' ? 'ollama' : 'service-rules', assessmentId: text(data.assessment_id, 120), urgency: urgency(data.urgency_level), isRedFlag: data.is_red_flag,
      escalation: text(data.escalation_message, 1000, true), possibleCauses: data.possible_causes.map((c) => ({ condition: text(c.condition, 200), likelihood: ["possible", "likely", "unlikely"].includes(c.likelihood) ? c.likelihood : "unspecified", rationale: text(c.rationale, 1000) })),
      questions: strings(data.recommended_questions_for_doctor), selfCare: text(data.self_care_notes, 1000, true), limitations: "Service output is labelled as model-generated or rule-based. Possibilities are not diagnoses. Clinical accuracy has not been validated." };
  }
  async function explain(ownerId, reportId, review) {
    const rows = reviewedRows(review);
    const data = await post(ownerId, '/api/reports/reviewed/explain', { report_id: String(reportId), review_version: review.version, rows }, 'reports');
    if (data.report_id !== String(reportId) || data.review_version !== review.version || data.origin !== 'ollama' || !Array.isArray(data.findings) || data.findings.length > 100 || !Array.isArray(data.flags) || data.flags.length !== rows.length) throw new ReportError(502,'INVALID_AI_RESPONSE','The AI returned a mismatched report revision or invalid findings.');
    const flags = new Map();
    for (const f of data.flags) { if (!rows.some(r=>r.id===f.id) || flags.has(f.id) || !['low','high','normal','inconclusive'].includes(f.flag)) throw new ReportError(502,'INVALID_AI_RESPONSE','Invalid report flags.'); flags.set(f.id,f.flag); }
    const conditions = data.possible_conditions ?? [];
    if (!Array.isArray(conditions) || conditions.length > 3) throw new ReportError(502,'INVALID_AI_RESPONSE','Invalid possible conditions.');
    const possibleConditions = conditions.map(c => {
      const supportingTests = strings(c.supporting_tests, 10);
      if (!supportingTests.length || supportingTests.some(name => !rows.some(r => r.testName === name && !r.unknown && !r.unreadable && ['low','high'].includes(flags.get(r.id))))) throw new ReportError(502,'INVALID_AI_RESPONSE','Condition evidence does not match abnormal reviewed values.');
      return { condition: text(c.condition,200), rationale: text(c.rationale,1000), supportingTests, uncertainty: text(c.uncertainty,500), followUp: text(c.follow_up,500) };
    });
    return { possibleConditions, modelVersion: data.model_version==null?null:text(data.model_version,120), summary: text(data.summary,4000), rows: rows.map(r=>({...r,flag:flags.get(r.id)})), findings: data.findings.map(f=>({testName:text(f.test_name,200),finding:text(f.finding,1000),explanation:text(f.plain_language_explanation,4000)})), questions: strings(data.doctor_discussion_questions), sources: [], escalation: null, limitations: [text(data.disclaimer,1000),'Model-generated explanations have not been clinically validated. Reference comparisons use your saved ranges. No verified retrieval sources were supplied.'] };
  }
  return { chat, symptoms, explain };
}
function reviewedRows(review) { return review.rows.filter(r=>!r.removed).map(r=>Object.fromEntries(['id','testName','rawValue','units','referenceRange','reportDate','unknown','unreadable'].map(k=>[k,r[k]]))); }
module.exports = { aiGateway, text, strings, reviewedRows };
