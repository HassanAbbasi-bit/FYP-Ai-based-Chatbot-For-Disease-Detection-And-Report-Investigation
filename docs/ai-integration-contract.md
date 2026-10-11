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

## Information needed from the AI service owner

All items below are pending:

| Item | What to confirm |
| --- | --- |
| Base URL | FastAPI URL reachable from the Express machine; do not use an assumed IP |
| Chat route | Exact endpoint path and HTTP method |
| Request | Exact fields, types, required/optional rules, and an example JSON request |
| Success | Exact response fields, types, and an example JSON response |
| Errors | Status codes and example error JSON |
| Authentication | Mechanism and header names; exchange credentials privately, never in source or chat |
| Transport | Streaming or non-streaming; framing if streaming |
| Context | Stateless messages or conversation history/session IDs; ownership and retention |
| Timing | Expected response time and timeout/cancellation behavior |
| Network | Whether the two computers share a network or use different networks; agreed secure connectivity |
| Retry | Idempotency and whether timed-out requests can safely be retried |

Missing information does not block this demo. Add confirmed details here only after the friend supplies and verifies them. Keep secrets in ignored server-side environment configuration when real integration is implemented. Never expose secrets or call Ollama from React.
