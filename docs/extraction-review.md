# Report extraction jobs and value review

Current verification uses **Demo extraction — synthetic sample**. The local FastAPI service was not listening on the supplied port 8000. An explicitly configured real adapter is implemented and tested against a synthetic local HTTP stub; no live OCR/inference was verified and no real medical report was transferred. The friend's Python implementation is unchanged. Medical interpretation is outside this checkpoint.

## Setup and sample workflow

Use Node 24 and existing MongoDB Atlas/replica-set settings. Existing private credentials are preserved. In `server/.env`, add `EXTRACTION_DEMO_ENABLED=true` for development. Leave `EXTRACTION_PROVIDER=off` to avoid any real service transfer. Restart Express. Production rejects an enabled demo; demo is false by default in every environment.

From root, terminal one: `cd server`, `npm.cmd ci`, `npm.cmd run dev`. Terminal two: `cd client`, `npm.cmd ci`, `npm.cmd run dev`. Open http://localhost:5173. Login → Reports → Create synthetic review sample → Run extraction → correct fields → Save draft → refresh/reopen → Mark reviewed → edit/save and observe outdated status.

The dedicated sample is a generated PNG visibly containing synthetic measurement, qualitative, comparator and unreadable examples with known matching fixture values. Demo eligibility requires a server-only sample marker **and** matching SHA-256 bytes. Uploading an arbitrary report or copying the sample filename never grants demo eligibility. Ordinary uploads display Extraction service not connected while the real provider is off. Synthetic originals are private per-account copies subject to existing report quotas/deletion; shared template code is not deleted.

For an agreed real service, explicitly set `EXTRACTION_PROVIDER=fastapi`, the exact supplied `AI_SERVICE_URL`, and `AI_INTERNAL_KEY` privately. No key is hardcoded, exposed to React or placed in a URL. The adapter posts one multipart `file` to `/api/reports/extract` with `X-Internal-Key`, transfers bytes rather than local paths, uses a generic generated filename, and refuses redirects. Source hash/size must still match. At most two requests run per process; maximum upload size is inherited from report configuration. Files are read into memory only within that bounded size. `EXTRACTION_TIMEOUT_MS` defaults to 45000 and accepts 1–60000. Responses are streamed into at most 256 KiB, require JSON, validate at most 100 rows and reject malformed values. Provider errors are mapped to safe messages, without health values, filenames, bodies or credentials in logs. Configure HTTPS for remote deployment and confirm provider privacy/retention before enabling real transfers.

## API

All routes require an owner session. Mutations retain exact Origin and CSRF protection. IDs and bodies are validated. Missing/inaccessible resources return the same 404. Per-account limits: 120 extraction-router requests/minute, 30 review/cancel mutations/minute, 10 start/sample attempts/15 minutes. These in-process rate limits reset at restart. Existing report rate limits also apply to requests passed through to the upload/history router.

| Endpoint | Body / result |
| --- | --- |
| POST /api/reports/sample | `{requestId: UUIDv4}`; creates/reconciles dedicated private sample, `{report}` |
| POST /api/reports/:id/extraction | `{requestId: UUIDv4, expectedVersion: integer}`; 202 `{job}` |
| GET /api/reports/:id/extraction | `{available,demoEnabled,job,attempts,result,review,reviewVersion}`; bounded last 20 attempts, current result and review |
| POST /api/reports/:id/extraction/:jobId/cancel | `{}`; local cancellation/fencing; provider cancellation is not confirmed |
| PUT /api/reports/:id/review | `{resultId,expectedVersion,rows,markReviewed:boolean}`; `{version,status}` |

Retry a failed attempt with a **new** requestId. Reuse the same requestId when the outcome of a start request is uncertain: the server returns the original persisted attempt. An active attempt blocks another start; failed attempts remain separate from successful ones. There are at most 20 attempts/report and 200 review versions/report. Review version is 0 before extraction; every successful extraction or review save increments it. These bounds limit database growth.

Job states are queued, running, succeeded, failed, cancelled. Stored provenance includes owner/report, source hash (never public), source version 1 for immutable originals, attempt sequence, origin, timestamps, safe errors and result identity. The provider is synchronous: it supplies a report ID, not an asynchronous job ID. No provider job IDs or model version are invented. Original results are stored separately from append-only review snapshots.

## Recovery, races and deletion

A small persistent MongoDB queue is scanned each second, with two active attempts in the existing single-process/private-root deployment. Queued/running leases last 90 seconds. Recovery handles at most 100 expired attempts per pass, marks them failed/INTERRUPTED and clears their report fence. Queued work within its lease resumes after restart; stale work is never blindly reissued. Provider completion after timeout/restart remains unknown until the provider supplies an idempotency/status contract. Explicit retries may perform new provider work; the UI and timeout messages say so.

Short majority/snapshot transactions reserve each attempt and publish results; external calls run outside transactions. Lease tokens and the report's active-attempt identity fence late results. Publication also checks source identity and the review version captured at start. If edits were saved during processing, the attempt fails with REVISION_CONFLICT and preserves the current result/corrections. Older extraction/review revisions remain recorded; a newer extraction does not mutate them. Re-extraction intentionally creates a fresh draft, so save/reconcile edits before requesting it.

Cancellation is local: the job becomes cancelled, its fence is removed, and the HTTP request/worker is aborted. FastAPI has no confirmed cancellation endpoint; aborting the connection does not prove remote processing stopped. Demo work is locally stopped. Deleting a report first marks it deleting and aborts local work; successful recoverable file deletion transactionally removes all associated jobs, original results and review snapshots along with report metadata/quota. Late results cannot recreate a deleted report. Failed private-file deletion retains linked data until retry/cleanup succeeds. No Express conversion artifacts are generated. Remote provider caches, backups and downloaded copies are not claimed deleted.

## Row and correction contract

Editable row fields:

```json
{"id":"UUIDv4","testName":"Synthetic screen","rawValue":"Negative","units":null,"referenceRange":null,"reportDate":null,"sourcePage":1,"unknown":false,"unreadable":false,"removed":false}
```

Limits: 100 rows, test name 160 characters, raw value/range 200, units 80, YYYY-MM-DD date or null, page 1–200 or null. Unknown/unreadable requires null rawValue. Missing values are never zero. Qualitative text remains text; parsedValue/comparator are derived server-side only for a complete finite decimal expression (optionally <, >, <=, >=). Units and reported ranges remain exact text; no medical range flags/diagnoses are computed. Parsed fields, ownership, origin, status, confidence and source provenance cannot be supplied by the browser.

Original extracted rows retain immutable values/page identity. Corrections preserve originalSourcePage while allowing an explicitly user-corrected page. Every original row must remain in review snapshots, with removed=true tombstones for excluded rows. Missed rows use new UUIDs and server-derived user-entered provenance. Reset copies the original fields; discarding an added row does not change original extraction records. Review saves record account editor and timestamps; raw values are not duplicated into general logs. User review is not medical approval.

PUT uses optimistic concurrency: wrong resultId or expectedVersion returns 409 REVISION_CONFLICT. The UI keeps unsaved edits and offers an explicit reload/discard path. Save draft retains draft, or changes reviewed to outdated. Mark reviewed saves the submitted revision as reviewed with a timestamp. New edits make the previous review outdated; no clinical validity is inferred. Account/navigation changes abort stale requests and previews; unsaved edits warn on switching reports, Chat, logout or closing/reloading the page. Values render as text in labelled controls. The original preview sits beside review on desktop and stacks on mobile; PDF retains download fallback, so page navigation is unavailable.

## Proposed future analysis payload — not sent anywhere

```json
{"schemaVersion":1,"reportId":"owned-report-id","reviewedRevisionId":"ReportReview-id","reviewVersion":3,"extractionResultId":"ExtractionResult-id","origin":"synthetic-demo-or-fastapi","sourceVersion":1,"rows":[{"id":"row-uuid","provenance":"extracted-or-user-entered","original":{"rawValue":null,"sourcePage":1},"reviewed":{"rawValue":null,"parsedValue":null,"comparator":null,"unknown":true,"unreadable":true,"sourcePage":2},"removed":false}]}
```

This is an Express-side proposal only. Future export must use an owner-authorized, still-current reviewed revision, include exact units/ranges/dates and original/corrected references, and exclude removed rows from analysis while retaining their audit history. No analysis endpoint, transmission, interpretation, comparisons or summaries are implemented.

See [verification](extraction-checkpoint-validation.md) and [remaining AI contract questions](ai-integration-contract.md).
