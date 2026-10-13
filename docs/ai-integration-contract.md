# Current Blood CP AI integration

The reviewed-data integration is now implemented in both Express and FastAPI. See [the current integration and startup guide](blood-cp-integration.md) for active contracts, supported features and verification. General chat, symptoms, extraction, reviewed interpretation and report chat are connected. FastAPI uses a matching private internal key even in debug mode. Clinical accuracy, verified retrieval citations, real longitudinal comparison and structured doctor-visit summaries remain outside the implemented backend contract.

The notes below document the previous checkpoint and its original missing contracts. They do not describe current reviewed-analysis availability.

---

# AI integration agreement

Checked-in public FastAPI schemas/routes confirm formats, not live inference or clinical accuracy. Python is unchanged. Adapters are verified synthetically; the actual reachable origin and matching key must be supplied privately. No example address is assumed to be a live deployment.

## Browser to Express

Same-origin APIs enforce sessions, ownership, CSRF/Origin and bounded rates. Chat: `POST /api/conversations/:id/messages`, `{message,requestId}`; UUID v4 retries reconcile persisted ordered messages, `mode=demo|ai` and validated structured output. Pending is HTTP 202; uncertain outcomes require explicit retry. Client ownership/history/report contents are not trusted.

Optional context/versioned consent use `/api/account`; profile is not automatically sent. Report upload is bounded multipart `file`; private originals, durable extraction attempts and versioned corrections remain in Express/MongoDB. Reviewed means owner-checked, not clinically validated.

## Confirmed supplied interfaces

| Operation | Active adapter contract |
| --- | --- |
| Chat | `POST /api/chat`, `{message,conversation_id,history:[{role,content}]}`; response `reply,suggested_follow_ups,urgency_level,disclaimer` |
| Symptoms | `POST /api/symptoms/assess`, `{symptoms,duration,severity,additional_notes}`; response `assessment_id,extracted_symptoms,urgency_level,is_red_flag,escalation_message,possible_causes,recommended_questions_for_doctor,self_care_notes` |
| Extraction | `POST /api/reports/extract`, multipart file bytes; response `report_id,report_date,tests[]` with `name,value,unit,reference_range,page,needs_review,review_reason` |
| Authentication/transport | Private `X-Internal-Key`; non-streaming JSON. No streaming/callback/cancellation contract is confirmed. |

Adapters use an exact server-configured HTTP(S) origin without embedded credentials/path, refuse redirects, keep secrets server-side and bound timeout/concurrency/output/schema. No arbitrary URL is fetched. Chat sends at most three completed owned prior pairs, each bounded to 2000 characters. `patient_context` is unmapped because the supplied route ignores it and necessary semantics are unconfirmed.

Real chat/symptoms require chat consent; real extraction requires report consent. Publication checks current account/consent/target. Withdrawal cannot recall a provider request already sent. Provider retention/cancellation/deletion and retry idempotency are unconfirmed. Local UUID publication does not guarantee exactly-once provider inference after timeout.

Explicit Development Mode chat fallback is rejected. Symptoms may return unlabelled heuristic fallback, disclosed in UI/docs. Extraction clinical flags/critical alerts are not consumed. Numeric values are supplied values, not original OCR text. Missing confidence/model/source fields are not invented; a provider default date is not a verified specimen date.

## Missing contracts

Existing `POST /api/reports/{report_id}/explain` reads process-local cached extraction and accepts no corrected revision; unknown IDs may yield generic fallback. It is deliberately not used for reviewed-data analysis/report chat. Only a dedicated server-marked/hash-checked synthetic sample demonstrates revision-bound results/conversations by copying saved entries without medical reasoning. Ordinary uploads never receive fixture findings; production rejects demos.

Real comparison matching/conversion and structured doctor-summary endpoints are unconfirmed. App completes history/selection, a separate compatible/incompatible/missing synthetic comparison and factual reviewed-data PDF without AI access. No fuzzy name matching, invented conversion, diagnostic trend or recommendations.

The friend must confirm corrected payload/revision identity, unknown handling, approved flags/urgency, explanations/uncertainty, safe sources, version provenance, report context isolation, comparison identities/units/specimen dates/ranges and summary fields. Exact JSON examples requested and proposed payloads are in [backend handoff](backend-handoff.md); proposals are not active endpoint mappings.

Software tests use disposable MongoDB/private storage, synthetic adapters/samples and browser accounts. Live model/auth/fallback, reviewed/citation/comparison/summary contracts, clinical urgency evaluation and external retention remain external dependencies. Deployment preparation documents operational limits; no compliance/production certification is claimed.
