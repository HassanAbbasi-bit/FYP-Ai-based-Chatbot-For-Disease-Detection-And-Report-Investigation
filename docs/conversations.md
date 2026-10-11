# Persistent conversations

React displays saved conversations and sends relative `/api` requests. Express verifies the account session, ownership, Origin, and CSRF token. MongoDB stores conversations, individual messages, and processing records. Replies still come from the local demo service. FastAPI/Ollama is not connected and no clinical analysis is performed.

## Database and setup

Keep the existing private `server/.env`: no new credentials or environment variables are needed. **MongoDB must support transactions: an Atlas cluster, replica set, or transaction-capable sharded cluster.** A standalone `mongod` is insufficient. Startup checks `hello` for a replica-set/sharded topology and exercises a read-only transaction before serving requests. The configured Atlas connection passed a read-only transaction without changing any records; automated writes are verified only on disposable test databases.

For a local database, configure a replica set (including a single-node development replica set), initiate it, and include its replica-set name in the URI. Do not use a standalone URI from the older authentication checkpoint. See MongoDB's [replica-set deployment instructions](https://www.mongodb.com/docs/manual/tutorial/deploy-replica-set/) and [transaction requirements](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/). The application database user needs read/write and index creation permissions on the application database. Transactions use snapshot reads and majority writes. Collections and indexes are initialized before serving requests.

No historical chat migration is possible: earlier demo messages existed only in browser memory. Existing users and sessions are preserved. Startup adds these collections/indexes automatically without deleting data:

| Collection | Stored data and indexes |
| --- | --- |
| `conversations` | `ownerId`, title (maximum 80 characters), timestamps, next sequence, one active request and lease; index on owner, descending activity time and ID |
| `messages` | owner, conversation, request UUID, user/assistant role, text, sequence, mode (`demo`/future `ai`), creation time; unique conversation+sequence and conversation+request+role |
| `chatrequests` | owner, conversation, request UUID, original text, pending/completed/failed status, reserved sequence pair, lease token/expiry, attempts, timestamps; unique conversation+request and owner+conversation+status index |

Messages are separate records. The conversation never contains an unbounded message array. JavaScript string length limits: user message 2,000; current assistant reply 4,000; title 80. Initial titles use the first 60 characters of normalized first-message text. Treat titles as private content. The application does not put them in URLs, document titles, or logs.

## Endpoint contract

Every endpoint requires a verified session. Owner IDs come exclusively from that session. Writes additionally require exact `Origin`, JSON, and `X-CSRF-Token` from `/api/auth/csrf`. Use the existing frontend API helper. IDs are MongoDB ObjectId strings. Absent, malformed, and other-user IDs consistently return 404 `NOT_FOUND`.

| Method and path | Input | Result |
| --- | --- | --- |
| POST `/api/conversations` | `{}` | 201 `{conversation}`; explicit user action only |
| GET `/api/conversations` | optional `limit` (1–50, default 20), opaque `cursor` | `{conversations, nextCursor}` in descending activity/ID order |
| GET `/api/conversations/:id/messages` | same limit; exclusive sequence cursor | `{conversation, messages, nextCursor, activeRequest}`; newest page, rows ascending by sequence; Load older prepends earlier pages |
| POST `/api/conversations/:id/messages` | `{message, requestId}`; UUID v4 from `crypto.randomUUID()` | 200 `{status:"completed", requestId, conversation, messages:[user,assistant]}` or 202 `{status:"pending", requestId, retryAfterMs:1000}` with Retry-After header |
| PATCH `/api/conversations/:id` | `{title}` | `{conversation}` |
| DELETE `/api/conversations/:id` | `{}` | `{deleted:true}` |

Public conversation: `{id,title,createdAt,updatedAt}`. Public message: `{id,conversationId,requestId,role,content,sequence,mode,createdAt}`. Active request: `{requestId,content,status,retryAfterMs}` or null. Ownership, role, sequence, processing status and mode cannot be supplied by React. Only the documented body fields are accepted. The old `/api/chat` endpoint was removed; it returns 404. Auth and health endpoints are preserved.

Errors use `{error:{code,message}}`: 400 invalid inputs/cursors/JSON, 401 signed out, 403 CSRF/Origin failure, 404 absent/inaccessible conversation, 409 `REQUEST_ID_REUSED` or `CONVERSATION_BUSY`, 413 body above 100 KB, 429 rate limit, 503 database/reply failure. Default per-IP limits: history 120/minute across conversation routes, creation 20/minute and submissions 30/minute. Existing auth limits remain. In-process rate limits reset on restart and are unsuitable for multiple production instances without a shared limiter store.

## Saving, concurrency and recovery

1. React generates one UUID for an intended submission, displays it immediately, and retains that UUID and exact text for retries. No chat data is written to localStorage/sessionStorage. Per-conversation drafts survive switching and recoverable failures within the current page.
2. A short transaction reserves consecutive user/assistant sequence numbers, saves the user message and unique request, and locks that conversation to this request with a random lease token. Another different request receives a recoverable 409. Simultaneous identical requests receive 202 while the first worker is active.
3. The local demo service runs outside the transaction. A second transaction checks the lease token and ownership, saves the assistant message, marks the request completed, and releases the lock. A crash between steps leaves a saved user message and recoverable request. No network call occurs inside a transaction callback.
4. Completed retries retrieve the same stored message IDs without generating another reply. Reusing the UUID with different text returns 409. Generation failure persists `failed`; retry reclaims it immediately. Pending leases expire after 30 seconds. After a process interruption, reopening exposes the original text and request ID; Retry reclaims an expired job. A current pending job stays pending until completion or lease expiry. Recovery is user-driven rather than a background queue.
5. A stale worker cannot publish after another worker reclaimed the lease. A different submission is blocked until the earlier request completes or the conversation is deleted, preserving ordering. Sequence numbers, rather than timestamps, order messages. The database uniqueness indexes arbitrate concurrency across processes.

A response lost after saving is safe to retry. An unsaved optimistic message survives only in the current page; refreshing while offline before the server receives it loses that in-memory submission/draft. Failed/pending messages that reached MongoDB survive refresh and login. Creation is an explicit action but is not idempotent: an uncertain create result should be reconciled with Refresh history before another New chat click. Concurrent edits to activity timestamps can shift conversation list pagination; Refresh history reconciles the current list. Message pagination has stable exclusive sequence boundaries.

## Privacy and deletion

Delete requires an accessible modal confirmation. A transaction hard-deletes the conversation, its messages, and its request records together. There is no recycle bin, retained tombstone, or soft-delete policy. In-flight workers must update that same conversation before publishing, so deletion conflicts/retries safely and late processing cannot recreate records. A lost delete response can be reconciled with 404 on retry. Other conversations and accounts are untouched.

This removes live application records, **not backups, database provider snapshots, oplogs, or already viewed/copied content**. Their retention is controlled by the database/deployment provider and has not been configured or verified here. Account deletion and report deletion are outside this checkpoint. Operational logs contain no message text, titles, cookies, or credentials. React renders message/title text rather than HTML. Sign-out/account changes unmount and clear all per-user client state; server persistence remains private to the owning account.

## Run and test

From the repository root, start two terminals:

```powershell
cd server
npm.cmd run dev
```

```powershell
cd client
npm.cmd run dev
```

Open `http://localhost:5173`. Sign in, choose New chat, send a synthetic message, refresh, switch/rename conversations, and confirm deletion. Keep both terminals running; do not start duplicate servers on the same ports.

```powershell
cd server
npm.cmd test
cd ../client
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Tests always own disposable single-node replica sets and synthetic accounts/messages. They never load `.env`, use an externally supplied MongoDB URI, or clear the real database. The first run may download an official MongoDB binary. For manual browser checks without touching your database, stop your normal server and run `node scripts/browser-test-server.js` from `server/`; it uses a disposable replica set on port 5000. Stop it after testing. See [checkpoint validation](conversation-checkpoint-validation.md) for actual checks and limitations.

## Future AI boundary

`server/src/services/chat.js` remains the demo generator. The conversation lifecycle supplies `{content,conversationId,requestId}` to a server-side generator; no unconfirmed FastAPI request is made. A future adapter must define bounded ordered context, timeout/lease renewal, output limits, cancellation, privacy/retention and external idempotency before integration. See [the pending AI contract](ai-integration-contract.md). This checkpoint adds no diagnosis, reports, uploads, or clinical rules.
