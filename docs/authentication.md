# MongoDB and authentication foundation

## Configure the database manually

No personal database has been provisioned or configured. Put credentials only in ignored `server/.env`.

**Local option:** install MongoDB Community Server from the [official Windows instructions](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/), start its local service, and use `mongodb://127.0.0.1:27017/fyp_auth`. Keep it bound to the local machine. Do not expose an unauthenticated development database to a network.

**Atlas option:** use an existing deployment or choose the free tier if available, without selecting a paid plan. In Atlas, create a database user with access scoped to the application database and allow only your current development IP. Obtain the application's connection string from Atlas, fill its username/password privately, and include a database name such as `fyp_auth`. URI-encode any reserved characters in credentials. Do not use an unrestricted network allowlist or paste the URI into chat. Follow the [official Atlas connection guide](https://www.mongodb.com/docs/atlas/connect-to-database-deployment/).

The database user must be able to create the `users` email unique index and `sessions` TTL index. Production permissions, backups, TLS, and retention require a separate deployment review.

## Environment

| Variable | Local setting / purpose |
| --- | --- |
| `MONGODB_URI` | Private MongoDB URI with explicit database name |
| `SESSION_SECRET` | At least 64 hexadecimal characters from 32 cryptographically random bytes; no fallback |
| `APP_ORIGIN` | Exact browser origin; locally `http://localhost:5173` (no trailing slash) |
| `NODE_ENV` | `development` locally; `production` enables Secure cookies and requires HTTPS origin |
| `PORT` | 5000 by default |
| `TRUST_PROXY` | Unset locally; only `loopback` is supported for an explicitly verified reverse proxy on this machine |

Generate a secret from the server terminal: `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Enter it in `.env` yourself. Startup never prints the connection string, database errors, or secret. Database initialization failures stop startup; runtime failures are JSON HTTP 503, distinct from HTTP 401 signed-out responses.

## API contract

All requests use the same-origin `/api` proxy, with cookies sent automatically. No CORS wildcard or cross-origin credential access is enabled.

1. `GET /api/auth/csrf` returns `{ "csrfToken": "<session-bound-token>" }` and sets an anonymous cookie only when a form needs CSRF state.
2. Include `Origin: <APP_ORIGIN>`, `Content-Type: application/json` and `X-CSRF-Token: <token>` on all POSTs.
3. Register: `POST /api/auth/register` with `{ "name": "Demo User", "email": "demo@example.com", "password": "an example long passphrase" }`.
4. Login: `POST /api/auth/login` with `{ "email": "demo@example.com", "password": "an example long passphrase" }`.
5. Success: registration HTTP 201 or login HTTP 200 with `{ "user": { "id": "<id>", "name": "Demo User", "email": "demo@example.com", "createdAt": "<timestamp>", "updatedAt": "<timestamp>" }, "csrfToken": "<new-token>" }`.
6. Restore: `GET /api/auth/me` returns `{ "user": { ...public fields... } }`; missing/expired session returns HTTP 401. No hash is returned.
7. Logout: `POST /api/auth/logout` with `{}` destroys the MongoDB session and expires its cookie.
8. Chat: `POST /api/chat` with `{ "message": "Hello" }` requires a valid session, origin, and CSRF token. It still returns `{ "mode": "demo", "reply": "...no medical analysis has been performed." }`. No conversation is persisted and browser-supplied identity fields are rejected.

Names are trimmed and limited to 1–80 characters. Email is trimmed/lowercased, validated, and limited to 254 characters. Passwords are 15–128 JavaScript characters, including spaces; they are never trimmed or truncated. Only the documented request fields are allowed. Password confirmation is a client check, not a stored field. MongoDB's unique email index resolves duplicate-key races with HTTP 409.

Errors are `{ "error": { "code": "...", "message": "..." } }`. Important statuses: 400 invalid input/JSON, 401 unauthenticated or generic `INVALID_CREDENTIALS`, 403 `CSRF_INVALID` / `ORIGIN_FORBIDDEN`, 409 `EMAIL_IN_USE`, 413 body above 100 KB, 429 `RATE_LIMITED`, 503 `SERVICE_UNAVAILABLE`, 500 unexpected internal error. No stack traces, passwords, cookies, or request bodies are logged. Register may create the account before a failed session write; if the result is uncertain, try signing in before registering again.

## Security choices and boundaries

Passwords use the maintained [node-argon2 library](https://github.com/ranisalt/node-argon2), Argon2id with 19 MiB memory, two iterations, one lane, and a random salt per password, matching the baseline in [OWASP guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html). Login uses the same generic error for missing accounts and wrong passwords, including dummy-hash verification for unknown accounts. These measures are not a claim of perfect timing indistinguishability.

[express-session](https://expressjs.com/en/resources/middleware/session/) stores only the signed session identifier in the cookie; [connect-mongo](https://github.com/jdesboeufs/connect-mongo) persists session state in MongoDB. Cookies are HttpOnly, SameSite=Lax, Path=/, host-only, and expire after eight hours. Authenticated sessions have a fixed eight-hour deadline; cookie and store expiry remain aligned. Production uses Secure and the `__Host-fyp.sid` name. IDs and CSRF tokens rotate after registration/login. Logout destroys the old session. Avoiding anonymous saves keeps health and signed-out `me` requests from creating sessions; fetching a CSRF token intentionally creates one.

[csrf-sync](https://github.com/Psifi-Solutions/csrf-sync) provides the maintained synchronizer-token protection for register, login, logout, and chat. Tokens stay only in client memory and server session state. Exact Origin and Fetch Metadata checks add another boundary. The API helper renews a token and retries once only after an explicit CSRF rejection; it does not automatically repeat operations after network errors or timeouts. Multiple tabs may invalidate each other's token when the session rotates; fetching a fresh token recovers that case.

[express-rate-limit](https://express-rate-limit.mintlify.app/) uses separate in-process per-IP buckets: registration 5/hour, login 10/15 minutes, chat 30/minute, CSRF bootstrap 100/15 minutes. Responses include rate-limit headers; limits reset on process restart and users behind one IP share them. These controls need a shared store and a verified proxy arrangement for multiple instances. Proxy trust is never enabled broadly.

Readiness `GET /api/ready` checks the connection and pings MongoDB. Liveness `GET /api/health` remains independent. Shutdown drains HTTP requests and closes session/database connections, with a ten-second deadline.

## Validation boundary

The automated suite owns temporary databases; browser-test fixtures also use a temporary database and ephemeral secret. Passing these checks does not verify your personal Atlas credentials, network allowlist, or deployment. Configure `.env` manually, run the normal server, and repeat the registration/chat/refresh/logout flow to finish local configuration validation.

Future work: email verification, password recovery, stale account/session management, production deployment hardening, and the separately confirmed AI integration. This checkpoint contains no medical records or clinical functionality.
