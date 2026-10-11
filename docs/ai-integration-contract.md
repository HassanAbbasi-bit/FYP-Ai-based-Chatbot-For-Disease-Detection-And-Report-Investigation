# AI integration agreement — awaiting confirmation

This is our implemented Express boundary and a proposal for future integration. **No friend-provided FastAPI endpoint, address, authentication, or schema is confirmed.** The friend's implementation has not been modified, contacted, or inferred from a different branch.

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
