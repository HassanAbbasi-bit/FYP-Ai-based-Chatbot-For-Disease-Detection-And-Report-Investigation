# Extraction/review checkpoint validation

Base: origin/main commit 72300ab, which includes merged conversation PR #5 and report PR #6. Branch: feature/report-extraction-review. No stacked dependency or automatic PR merge.

Commands: from server `npm.cmd test`; from client `npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`; from root `git diff --check`. Integration fixtures create owned disposable MongoDB replica sets and temporary private storage without loading .env. Tests use only synthetic files/accounts. No user database/directory was cleared.

Backend includes 66 existing auth/conversation/upload tests, 18 extraction/review integration tests and five adapter/config tests. Coverage includes success/status/results, failure/timeout/explicit retry, idempotent/concurrent starts, invalid/oversized output, stale recovery, auth/CSRF/ownership, immutable originals, qualitative/comparator/unknown rows, additions/removals, revision conflicts, reviewed/outdated status, late-response fencing, cancellation, deletion races/cascade and arbitrary-upload demo exclusion. Adapter checks use a local synthetic HTTP stub for exact multipart/file/auth transport, response size/schema validation, redirect refusal and aborts. These are not live FastAPI tests.

Frontend includes 11 existing tests and three extraction API tests for allowed correction fields/explicit unknowns, CSRF retry preserving attempt identity and qualitative/removed rows. Browser workflows use isolated API 5500, Vite 5174, temporary MongoDB/storage and an explicitly enabled synthetic failure-once test adapter. Browser artifacts stay outside Git and contain synthetic data only.

Live-service verification is blocked: supplied localhost:8000 is not listening, and no private configured service key was requested or exposed. The demo workflow and adapter contract are independently testable. No live OCR/inference, clinical validation, external retention/cancellation/deletion, production deployment or malware scanning is claimed. Python code is unchanged.

Verified totals: 89 backend tests, 14 frontend tests, ESLint and production build. Ten Chrome workflows passed with no page errors: sample/failure/retry, correction persistence/refresh, reviewed-to-outdated status, added/removed/reset rows, two-tab conflicts, unsaved navigation, network save failure/retry, mobile keyboard editing without overflow, ordinary-upload demo exclusion, and logout/account isolation.
