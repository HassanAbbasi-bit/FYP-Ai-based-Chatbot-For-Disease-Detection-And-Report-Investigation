# AI integration agreement — current app and supplied service contract

This document records the implemented React/Express boundary, future adapter requirements, and the friend-supplied FastAPI specification now present on main. The AI implementation is preserved unchanged. Its supplied contract is recorded below; runtime behavior and Express integration have not been verified in this checkpoint.

## Confirmed current React → Express format

Chat now uses `POST /api/conversations/:conversationId/messages`, JSON `{message, requestId}`. The message is a non-blank string up to 2,000 JavaScript characters; requestId is a client-generated UUID v4 reused for the same intended submission. A valid MongoDB-backed account session, exact Origin and synchronizer CSRF token are required. Express derives ownership from the session. The earlier `/api/chat` route was removed.

Completed response: `{status:"completed", requestId, conversation:{id,title,createdAt,updatedAt}, messages:[userMessage,assistantMessage]}`. Each stored message is `{id,conversationId,requestId,role,content,sequence,mode,createdAt}`. Roles currently include user and assistant; assistant messages are created only server-side. The response mode is `demo`, and assistant text explicitly states that the AI service is not connected and no medical analysis was performed. Pending responses use HTTP 202; retry/conflict/failure contracts and pagination are documented in [conversations](conversations.md).

The internal generator is `server/src/services/chat.js`. The lifecycle supplies `{content,conversationId,requestId}` and expects `{mode:"demo",reply:string}`. It runs outside short database transactions. Ordered user/assistant messages and request lifecycles are stored separately. MongoDB transactions and lease tokens prevent duplicated publication and deletion races. This internal interface is **not a confirmed FastAPI request format**.

## Proposed future Express → FastAPI boundary

React continues using same-origin Express routes and never accesses Ollama or AI credentials. An Express-side adapter could read bounded owner-authorized context from MongoDB, sorted by sequence, and map `{role,content}` rows to the friend's confirmed format. Context should include only complete prior exchanges plus the current user message, exclude duplicate current messages, and use a confirmed message/token budget. Do not send an entire indefinitely growing history by default. Conversation/request IDs must be scoped or mapped according to the agreed privacy contract.

External generation should use timeouts/cancellation and an explicit retry/idempotency agreement. Current leases expire after 30 seconds and recovery is user-driven; a slower AI adapter needs lease renewal and fencing, or another agreed bounded execution strategy. The external service must not be invoked inside a database transaction callback because MongoDB may rerun that callback. A stale or deleted conversation's reply must not be published. External service retention and cancellation require confirmation; application deletion cannot promise deletion from a future external service without an implemented contract.

The current service accepts demo output only. Real integration must explicitly permit and label `ai` mode, validate and bound the output, and preserve a safe failure envelope. Do not disguise real AI replies as demonstrations. No clinical rules are introduced here.

## Information still needed from the AI owner

| Item | Required confirmation |
| --- | --- |
| Base URL and network | Actual address reachable from Express; secure connectivity between machines |
| Route | Exact path and method |
| Request | Fields, required/optional rules, example JSON and context format |
| Response | Exact success/error envelopes and output limits |
| Authentication | Mechanism/header names; credentials exchanged privately |
| Transport | Streaming or non-streaming; framing if streaming |
| Context | Who owns history, context/token limits, session/conversation mapping |
| Timing | Expected latency, timeout, cancellation and lease strategy |
| Retry | Whether generation supports request IDs/idempotency after timeout |
| Privacy | Retention, logging, onward data transfer and deletion behavior |
| Health scope | Agreed disclaimer, escalation and clinical limitations before real output |

Persistent demo chat does not depend on these answers. Add details here only when supplied and verified. Secrets remain in ignored server-only environment configuration.

## Report processing: implemented boundary and remaining questions

Uploads work independently of FastAPI. Express now provides persistent jobs, versioned review/corrections, an opt-in dedicated synthetic sample, and a configurable FastAPI adapter. See [extraction/review API](extraction-review.md). The supplied local service was not reachable during verification; adapter transport/schema tests use a synthetic local HTTP stub. Real inference is not claimed.

The supplied route is POST /api/reports/extract, multipart field file, with X-Internal-Key and synchronous JSON. AI_SERVICE_URL and AI_INTERNAL_KEY are private server configuration; no fallback secret is used. The adapter maps the checked-in ReportExtractionResponse/LabTestItem schema: report_id, report_date, tests[].name/value/unit/reference_range/page/needs_review/review_reason. Service-derived medical status, critical_alerts and clinical explanation output are intentionally not used in this review checkpoint. A numeric provider value is stringified as its supplied value, not claimed to be original OCR text. No extractor/model version or defined confidence score is supplied, so none is invented.

These details still require the friend/deployment owner's confirmation before live integration is claimed:

- Actual reachable deployment origin and privately exchanged service key matching X-Internal-Key.
- Server-enforced byte/page/dimension limits, concurrency and actual error JSON examples (including validation HTTP 422).
- Whether the synchronous API is final; if asynchronous behavior is added, exact job IDs/status values and polling/callback/stream framing.
- Provider timeout, cancellation, retry/idempotency, retention and remote deletion guarantees. Local cancellation currently does not confirm provider cancellation.
- Exact success and error JSON examples, maximum result sizes and privacy/retention/deletion behavior.
- Separate original OCR raw value versus parsed value, exact date/page semantics and extractor/model version if available.
- Indicators for unreadable text and uncertain values, how the user corrects values, and the correction/re-analysis contract.

Proposed fields below are our discussion checklist only; none are confirmed mappings or clinical interpretations:

```json
{"tests":[{"testName":null,"rawValue":null,"parsedValue":null,"units":null,"referenceRange":null,"reportDate":null,"sourcePage":null,"unreadable":false,"uncertain":false}],"warnings":[]}
```

Proposed error envelope for discussion: `{"error":{"code":"UNCONFIRMED_CODE","message":"Safe message"}}`. The friend's actual examples must resolve remaining gaps before live integration is claimed. Nullability, numeric/range representation, date format, page numbering, confidence meaning and job status vocabulary all need agreement. We have not invented an address, endpoint, secret or confirmed mapping. React must continue using owner-authorized Express routes rather than contacting Ollama directly. The next checkpoint is live synthetic verification of the implemented adapter and agreement on a reviewed-data analysis contract; medical analysis remains separate.

## FastAPI specification supplied by the friend (integration pending)

The following details were supplied on main. Performance figures are the supplier's claims, not checks performed during this merge. The example is documentation only and does not replace the implemented conversation lifecycle.

| Item | Confirmed Value | Details |
| --- | --- | --- |
| **Base URL** | `http://127.0.0.1:8000` | Configured via `AI_SERVICE_URL` in `server/.env`. |
| **Chat Route** | `POST /api/chat` | Main conversational endpoint with red-flag emergency detection. |
| **Request Schema** | `{"message": string, "conversation_id": string, "history": [{"role": "user"|"assistant", "content": string}]}` | Max length 2,000 characters; `history` is optional list of prior turns. |
| **Success Response** | `{"reply": string, "conversation_id": string, "urgency_level": "low"|"moderate"|"high"|"emergency", "red_flag_detected": boolean, "follow_up_questions": [string]}` | Non-streaming JSON response. |
| **Error Handling** | HTTP 400 (`detail`: validation error), HTTP 401 (`detail`: invalid API key), HTTP 500 (`detail`: service error) | Standard FastAPI error envelope. |
| **Authentication** | Header: `X-Internal-Key: REPLACE_WITH_PRIVATE_SERVICE_KEY` | Express passes this header in internal HTTP requests. |
| **Transport** | Non-streaming JSON over HTTP/1.1 | Standard RESTful API contract. |
| **Context & Sessions** | Express passes `conversation_id` and previous `history` turns | Stateless on FastAPI; Express manages conversation persistence if needed. |
| **Timing & Latency** | ~7 seconds on local GPU inference | Express Axios/fetch timeout recommended: 30 seconds (`timeout: 30000`). |
| **Symptom Route** | `POST /api/symptoms/assess` | Body: `{"symptoms": [string], "duration": string}`. |
| **Report Upload** | `POST /api/reports/extract` | Multipart form-data with `file=@report.jpg`. Parses tests in < 2 seconds. |
| **Report Explain** | `POST /api/reports/{test_id}/explain` | Grounded clinical explanation for a test parameter. Sub-millisecond repeat cached retrieval. |
| **Live Contract** | `GET /api/sample/contract` | Returns full sample response payload for all endpoints. |

### Express Adapter Example (`server/src/services/chat.js`)
```javascript
const axios = require('axios');

async function getChatReply(message, history = [], conversationId = 'conv_default') {
  const response = await axios.post(
    `${process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000'}/api/chat`,
    {
      message,
      history,
      conversation_id: conversationId,
    },
    {
      headers: {
        'X-Internal-Key': process.env.AI_INTERNAL_KEY,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );
  return response.data;
}

module.exports = { getChatReply };
```

### Reconcile supplied details with source before integration

The checked-in `ai-backend/app/models/schemas.py` chat response declares `reply`, `suggested_follow_ups`, `urgency_level` and `disclaimer`; this differs from the supplied table. The report explanation route parameter in source is `report_id`. Confirm those differences before mapping fields. The supplied extraction route is synchronous multipart with field `file`; job IDs/status polling, cancellation, bounded limits, separate raw/parsed values and correction/re-analysis still need agreement. Earlier checklist fields remain proposals for missing details, not a claim that no service code exists. Configure any future service key privately without a hardcoded fallback. Do not copy the adapter example over the current transaction/lease-aware conversation implementation.
