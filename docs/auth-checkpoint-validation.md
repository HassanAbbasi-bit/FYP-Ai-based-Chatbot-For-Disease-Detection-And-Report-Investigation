# Authentication checkpoint validation

Recorded 11 October 2026. Implementation is complete; validation against the owner's database and browser remains pending.

## Passed

- Server: 27 integration tests using owned temporary MongoDB 8.2.6 instances, never the user's `.env` or database.
- Registration/login, email normalization, unique-index races, input validation, Argon2id parameters, and exclusion of hashes from public responses.
- Session restoration and ID rotation, fixed expiration, logout invalidation, Secure/HttpOnly/host-only production cookie configuration with a simulated loopback HTTPS reverse proxy.
- Authenticated demo chat, unauthenticated HTTP 401, message limits, untrusted browser identity rejection, CSRF rejection and stale-token rotation, origin rejection, malformed and oversized JSON.
- Login/registration/chat rate limits; HTTP 503 readiness/auth responses after stopping the owned MongoDB while health stays HTTP 200.
- Client: five API-helper tests for CSRF bootstrap/rotation, rejected-operation retry, no automatic network replay, concurrent bootstrap, and distinguishing HTTP 401 from HTTP 503.
- Client lint and production build.
- Normal startup safely rejects a placeholder MongoDB URI without printing credentials.

## Pending

- The owner must privately fill `MONGODB_URI` in ignored `server/.env`. A random session secret was generated locally; no secret is tracked. Personal connection/authentication and network rules are not verified.
- Browser tooling failed to initialize with a missing runtime-assets path, including after reset. No registration/chat/refresh/logout, wrong-login display, mobile layout, keyboard navigation, or visual success is claimed for this checkpoint. Repeat these checks once browser tooling is available or manually through the UI.
- Not production-ready or security-certified. Email verification, recovery, real AI, uploads, health profiles, and conversation persistence remain out of scope.

Keep the PR in draft until local database configuration and the browser checks are complete. Do not merge automatically.
