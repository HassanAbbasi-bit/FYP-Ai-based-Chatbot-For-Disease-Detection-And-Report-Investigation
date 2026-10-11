# Conversation checkpoint validation

## Base and scope

The conversation branch starts from `origin/main` at `87230e0`, which contains merged authentication PR #4 and backend startup fix `643eb94`. There is no unmerged prerequisite dependency and no automatic merge was performed. The original authentication/demo foundations were checked first: 28 server tests, five frontend helper tests, lint, and production build passed before implementation. The friend's AI branch was not modified or integrated.

## Automated checks

Final checks use owned disposable single-node MongoDB replica sets and synthetic accounts/messages. No test reads `.env` or uses/deletes a real user's database.

- 45 backend tests: existing authentication, sessions, CSRF, Origin, body limits, rate limits, readiness and startup tests plus conversation create/list/reopen/rename/delete, stable pagination, owner isolation, invalid inputs/IDs, removed legacy route, lost-response retries, changed-text conflicts, competing reservations, pending/failed recovery, stale-worker fencing, deletion while generating, associated-record cleanup, database outage and logout access rejection.
- Nine frontend tests: token/bootstrap behavior, explicit CSRF retry, uncertain-mutation handling, account-change cancellation, unchanged submission request IDs on token renewal, optimistic reconciliation and ordered older-page merging.
- Frontend ESLint and Vite production build.
- `git diff --check`.

## Browser checks

Chrome was run headlessly through bundled Playwright against `server/scripts/browser-test-server.js` and Vite. This server owns a temporary replica set, uses an ephemeral session secret, never loads `.env`, and is distinct from normal development startup.

Verified through the UI:

1. Register → New chat → send → refresh → reopen with stable saved messages.
2. Switch between conversations without showing another thread's content.
3. Rename through a labelled modal.
4. Simulated network failure → Retry message; original UUID is retained, no duplicate user row, and a new draft is preserved.
5. Delete confirmation, Escape cancellation, and confirmed removal from history.
6. Sign out → another account sees no earlier user's history.
7. Sign back in to the first account and restore its saved history.
8. Drop a response after the server saved it → retry reconciles existing records without duplicates.
9. Delay a saved submission response → switch conversations before release; reply remains in its original thread.
10. Reopen the latest 20 messages and load older records to retrieve the complete synthetic history.
11. Conversation-list pagination retrieves all synthetic entries while retaining the selected thread beyond the first page.
12. 390×844 mobile navigation, no horizontal overflow, keyboard Tab/Enter submission; native modal Escape operation.

No browser page errors occurred. Browser localStorage and sessionStorage stayed empty. Desktop and mobile screenshots were visually inspected; screenshots and synthetic browser outputs are kept outside the repository.

## Configured Atlas and remaining limits

A read-only `hello` and a read-only snapshot transaction succeeded using the existing private configuration. No records were written or deleted for this check. Automated and browser mutation tests used only the disposable databases. The owner can repeat the normal development flow against Atlas manually; production deployment, provider backup/retention behavior, multi-instance rate limiting and long-running external AI generation were not verified or implemented.

No requested development checks are blocked. Replies remain DEMO. Retry recovery is user-driven after a 30-second pending lease expires; there is no background queue. Unsaved drafts/unsent optimistic messages remain only in memory. Creation has no request UUID, so an uncertain create response should be reconciled with Refresh history. Conversation list pagination can shift when activity changes; message sequence pagination is stable. Live deletion does not remove backups. See [full behavior and setup](conversations.md).
