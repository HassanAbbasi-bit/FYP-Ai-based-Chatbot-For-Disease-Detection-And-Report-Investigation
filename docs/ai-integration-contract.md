# AI integration agreement — awaiting confirmation

This document proposes a boundary between React, Express, and the friend's FastAPI service. **It is not a confirmed FastAPI API specification.** No friend-provided endpoint, address, schema, or authentication has been verified.

## Implemented React → Express demo contract

- `POST /api/chat`, JSON body: `{ "message": "Hello" }`.
- `message`: non-blank string, maximum 2,000 characters (JavaScript string length).
- Success HTTP 200: `{ "mode": "demo", "reply": "Test reply: Express received your message. The AI service is not connected yet, so no medical analysis has been performed." }`.
- Errors: `{ "error": { "code": "INVALID_MESSAGE", "message": "Message must be a non-blank string of at most 2,000 characters." } }`.
- HTTP 400: `INVALID_MESSAGE` or `INVALID_JSON`; HTTP 413: `BODY_TOO_LARGE`; HTTP 404: `NOT_FOUND`; HTTP 500: `INTERNAL_ERROR`.
- Non-streaming and stateless. No clinical output or health-data persistence.
- Authentication checkpoint: chat now requires a MongoDB-backed session cookie, the configured application Origin, and an `X-CSRF-Token` obtained through `GET /api/auth/csrf`. See [authentication](authentication.md). This is our Express boundary; it does not confirm any FastAPI API or authentication mechanism.

## Proposed future boundary

React keeps using relative Express `/api` requests. Express validates requests and calls a FastAPI adapter that replaces `server/src/services/chat.js`. FastAPI owns Ollama access. Any proposed future response envelope or field mapping must be agreed before implementation; the demo's `mode` field must never disguise real AI output as a demo or vice versa.

## Confirmed FastAPI Specification (Supplied by Friend 1)

All integration items have been implemented, benchmarked, and verified:

| Item | Confirmed Value | Details |
| --- | --- | --- |
| **Base URL** | `http://127.0.0.1:8000` | Configured via `AI_SERVICE_URL` in `server/.env`. |
| **Chat Route** | `POST /api/chat` | Main conversational endpoint with red-flag emergency detection. |
| **Request Schema** | `{"message": string, "conversation_id": string, "history": [{"role": "user"|"assistant", "content": string}]}` | Max length 2,000 characters; `history` is optional list of prior turns. |
| **Success Response** | `{"reply": string, "conversation_id": string, "urgency_level": "low"|"moderate"|"high"|"emergency", "red_flag_detected": boolean, "follow_up_questions": [string]}` | Non-streaming JSON response. |
| **Error Handling** | HTTP 400 (`detail`: validation error), HTTP 401 (`detail`: invalid API key), HTTP 500 (`detail`: service error) | Standard FastAPI error envelope. |
| **Authentication** | Header: `X-Internal-Key: medical-ai-internal-key-2026` | Express passes this header in internal HTTP requests. |
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
        'X-Internal-Key': process.env.AI_INTERNAL_KEY || 'medical-ai-internal-key-2026',
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );
  return response.data;
}

module.exports = { getChatReply };
```
