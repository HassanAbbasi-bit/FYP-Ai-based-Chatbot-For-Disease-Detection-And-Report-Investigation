# Private report uploads

Supported flow: Login → Reports → Upload → List → Open/Preview/Download → Delete. Status is **Uploaded — analysis is not connected yet.** No extraction, OCR, correction, diagnosis or AI calls are implemented.

## Setup

Use Node 24 and the existing private `server/.env` with MongoDB Atlas or a replica set supporting transactions. Run `npm.cmd ci` in server and client, then `npm.cmd run dev` in each in separate terminals. Open http://localhost:5173. Preserve existing MongoDB credentials and session secret. Collections/indexes initialize automatically.

| Server variable | Default | Bound |
| --- | --- | --- |
| REPORT_STORAGE_DIR | server/private-reports (absolute project path) | Outside client and every publicly served directory |
| REPORT_MAX_BYTES | 10485760 (10 MiB) | 1–25 MiB |
| REPORT_MAX_COUNT | 20 | 1–1000 |
| REPORT_MAX_TOTAL_BYTES | 104857600 (100 MiB) | At least per-file limit, at most 1 GiB |
| REPORT_MAX_PIXELS | 20000000 | 1–40000000 |

Storage is automatically created, ignored by Git, and never served statically. Generated UUID keys determine paths; original names never determine paths. POSIX directory/file modes are 0700/0600. On Windows restrict directory ACLs to the service account; chmod alone does not enforce Windows ACL isolation. Custom storage outside this repository must also be excluded from any other repository and public web root. Keep MongoDB and this directory together in recovery planning. Local storage requires a persistent disk, one Express process per storage root, and consistent database configuration. A PID lock rejects another process using that directory. Ephemeral hosting and multiple instances require a different shared storage implementation. No paid service is provisioned.

## API

All endpoints require the existing session cookie; ownership comes exclusively from that session. Writes require the existing exact Origin and CSRF token. Missing/inaccessible/malformed report IDs return the same 404. Structured errors contain no private storage keys or absolute paths.

| Method/path | Contract |
| --- | --- |
| POST /api/reports | multipart/form-data, exactly one file field `file`, no other fields; UUID v4 `X-Upload-ID`; 201 new or 200 reconciled saved upload |
| GET /api/reports | `limit` 1–50 (default 20), optional opaque `cursor`; `{reports,nextCursor,limits}` |
| GET /api/reports/:id | `{report}` |
| GET /api/reports/:id/file | Original validated bytes; optional `download=1`; uploaded records only |
| DELETE /api/reports/:id | Empty JSON object; `{deleted:true}` after private original and metadata are removed |

Public report fields: id, displayName, originalFilename, fileType, size, status, createdAt, updatedAt. Status is uploading, uploaded or deleting. History sorts by immutable creation time and ID; pagination stays bounded. PDFs always download as attachments; the UI deliberately uses an authenticated download fallback. Images use authenticated fetch and temporary object URLs, revoked when replaced, deleted or signed out. Responses set validated Content-Type, safe disposition, private/no-store, nosniff, restrictive CSP and same-origin resource policy. Cookies/CSRF secrets are never placed in URLs. Browser report contents are not saved in localStorage/sessionStorage or service worker caches.

Limits are enforced server-side: 10 upload attempts per account per 15 minutes, 30 file requests per minute, 120 report API requests per minute; two simultaneous validations globally. Limits reset on process restart. A shared rate-limit store is needed for multiple instances. Uploads reserve the configured maximum file size and one report slot before receiving bytes; finalization reduces reserved bytes to actual size. This conservative reservation can reject an upload even if the selected file would fit in remaining space. Pending deletions keep quota until cleanup completes.

## Validation and recovery

Busboy streams bounded uploads to exclusive temporary files; signatures, declared extension/type and basic structure are checked. Sharp fully decodes JPEG/PNG with a pixel cap, maximum side 8192, and one frame. The maintained Cantoo PDF parser rejects encrypted PDFs, malformed structure, more than 200 pages and invalid/excessive page dimensions. Worker validation has a 10-second deadline and bounded JS heap; total upload deadline is 120 seconds. Original bytes are retained without document conversion or executing embedded content. Signature and structural checks **are not malware scanning**, and downloaded files remain untrusted. These checks do not establish production readiness or clinical validation.

Filesystem and MongoDB cannot commit atomically. Durable uploading/deleting metadata tracks each original key. Publication follows validation; short MongoDB transactions update lifecycle and per-account counters. Errors and aborts remove temporary files where possible; unavailable database/storage leaves a recoverable record rather than silently losing its key. Cleanup runs at startup and every 60 seconds: at most 100 stale lifecycle records and 100 generated-file scan entries per pass. Upload leases last five minutes. Untracked generated files must be at least 15 minutes old before removal; active uploads are skipped. Cleanup requires successful database lookup before deleting a suspected orphan. Failed cleanup retries on a later pass; restart resumes reconciliation. Never manually clear the upload directory or database to troubleshoot.

Reuse the same upload UUID for retrying the same selected file. Completed retries compare SHA-256 and return the existing record; different bytes with that UUID return 409. Concurrent/incomplete retries return 409; refresh history before retrying an uncertain outcome. Changing the selected file generates a new UUID. Cancelling requests cannot undo an upload that already committed.

Deletion first marks the record deleting, then removes private files, then releases metadata/quota transactionally. Storage/database errors return failure and preserve recoverable state; retry or background cleanup completes it. Repeated deletion of an absent record returns 404, which the UI treats as already deleted. The interface releases preview references. Deletion covers live originals and application metadata, not external backups, downloaded copies, screenshots or copies already held by clients. No backup retention policy is implemented.

Validation commands and actual results: [checkpoint verification](report-checkpoint-validation.md). Parser references: [Busboy](https://github.com/mscdex/busboy), [Sharp input limits](https://sharp.pixelplumbing.com/api-constructor), [maintained PDF library](https://github.com/cantoo-scribe/pdf-lib).
