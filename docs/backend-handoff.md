# Exact AI owner handoff

Confirmed from the checked-in public FastAPI interfaces (not live inference): `POST /api/chat`, `POST /api/symptoms/assess`, multipart `POST /api/reports/extract`, non-streaming JSON and `X-Internal-Key`. Express adapters implement and validate these formats with synthetic tests. The Python service remains unchanged.

Chat request example (synthetic):
```json
{"message":"Synthetic question","conversation_id":"owned-application-id","history":[{"role":"user","content":"Previous synthetic question"},{"role":"assistant","content":"Previous complete response"}]}
```
Provide a live success/error example with `reply`, `suggested_follow_ups`, `urgency_level` (low/moderate/high/emergency), `disclaimer`, explicit model/fallback origin, model/prompt versions and bounded citations if available. Express sends at most three completed pairs (each truncated to 2000 characters), no automatic optional profile. The supplied `patient_context` field is not used by the route; agree actual necessary fields/semantics before profile transmission. Development-mode chat fallback is rejected, not presented as live inference.

Symptom request example:
```json
{"symptoms":["Synthetic concern"],"duration":"Synthetic duration","severity":null,"additional_notes":null}
```
Provide examples of `assessment_id`, `extracted_symptoms`, `urgency_level`, `is_red_flag`, `escalation_message`, `possible_causes` (condition/likelihood/rationale), `recommended_questions_for_doctor`, `self_care_notes`. Crucially, add an explicit origin/fallback indicator: the supplied implementation can return heuristic fallback without labelling its origin. No clinical accuracy or approved urgency rules are inferred from synthetic adapter checks.

Extraction accepts file bytes via `file`, not an Express filesystem path. Provide exact success/error examples and meaning of `report_date`, `tests[].name/value/unit/reference_range/page/needs_review/review_reason`; separate original OCR text from parsed values, unknown/unreadable semantics and extractor/model version. The current date default must not be treated as a specimen date. Current adapter does not consume provider clinical flags/critical alerts.

Missing reviewed-data analysis contract — proposal for discussion only; do not invent/enable an endpoint:
```json
{"report_id":"owned-id","review_revision":3,"request_id":"uuid-v4","rows":[{"row_id":"stable-id","test_name":"Synthetic measurement","raw_value":null,"parsed_value":null,"comparator":null,"unit":null,"reported_reference_range":null,"reviewed_report_date":null,"unknown":true,"unreadable":true,"provenance":"user-corrected"}]}
```
Agree exact names/required fields, endpoint/authentication and identity/revision echo. Provide structured output examples for values/units/ranges, backend-approved range flags, explanations, missing information, escalation, safe citation URL/title/source ID, limitations, generation/model/prompt versions. Define unresolved-field handling. Existing `/api/reports/{report_id}/explain` reads process-local cached extraction and accepts no corrected payload; calling it cannot analyze our reviewed revision. Unknown report IDs may return generic fallback. Therefore it is deliberately not integrated.

Report chat additionally needs an explicit server-authorized report/review/analysis context contract, context budget, revision echo and no cross-report cache leakage. Comparison needs stable measurement codes/method/specimen meaning, specimen dates with provenance, exact unit compatibility, validated conversion if any, report-specific range context, missing/comparator handling and source provenance; never fuzzy name matching. Doctor-summary needs confirmed factual structured fields and uncertainty/questions/sources, with no invented recommendations. Until supplied, app provides separate synthetic result/comparison demos and a factual reviewed-data PDF only.

Supply privately: actual reachable service origin, matching internal key, TLS/network topology; do not put credentials in chat or docs. Agree request/response size, concurrency, errors (including 422), latency within bounded deadlines, provider retry/idempotency, cancellation and retention/deletion/logging guarantees. Chat deadline is 20s under 30s lease; extraction max configured 60s, default 45s. No streaming protocol is confirmed, so app does not stream.

Required live integration verification with synthetic data: authenticated chat/extraction success, invalid key, offline model and explicit fallback, malformed/oversized responses, timeout/provider retry semantics, same-owner history context isolation, corrected revision echo, stale/deleted/withdrawn-consent publication, unknown units/dates/qualitative values, source validation, incompatible comparisons and summary provenance. Clinical evaluation and urgency approvals require shared work with qualified reviewers, not these software tests.
