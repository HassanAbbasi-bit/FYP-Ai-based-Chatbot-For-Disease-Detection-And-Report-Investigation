# FYP Health Workspace

React/Express app with MongoDB accounts/sessions, persistent conversations, private validated uploads, extraction jobs and versioned user review. Remaining application checkpoints add optional profile/consent, configured chat/symptom adapters, dedicated synthetic revision-bound results/report conversations, filtered history/comparison selection, factual PDF export, feedback, privacy/deletion and an actual-count dashboard. The friend's `ai-backend/` is unchanged.

Real chat/symptoms/extraction require explicit private configuration and live verification. Corrected-report analysis/chat, real comparison and doctor-summary contracts remain missing. Demo findings never attach to ordinary uploads. Review means user-checked, not clinical validation. No clinical/production certification is claimed. See [actual status](docs/implementation-status.md), [AI agreement](docs/ai-integration-contract.md) and [exact backend handoff](docs/backend-handoff.md).

## Setup and run

Use Node 24 and install locked dependencies:
```powershell
cd server
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
cd ../client
npm.cmd ci
```
Edit `server/.env` privately: preserve your valid `MONGODB_URI` with an explicit application database on Atlas/replica set, a random hex `SESSION_SECRET` of at least 32 bytes, `APP_ORIGIN=http://localhost:5173`, `NODE_ENV=development`, `PORT=5000`. A standalone database lacks required transactions. Never paste/commit credentials.

Two terminals from the project root:
```powershell
# Terminal 1
cd server
npm.cmd run dev
```
```powershell
# Terminal 2
cd client
npm.cmd run dev
```
Open `http://localhost:5173`. Backend is loopback port 5000. `/api/health` is liveness; `/api/ready` checks MongoDB. `npm.cmd` avoids PowerShell execution-policy issues.

## Short synthetic walkthrough

1. Register a test account; Dashboard shows actual saved counts.
2. Settings: optional context may stay unknown. Choose/save chat/report processing permission. Profile context is not automatically transmitted.
3. Chat: New chat, send a synthetic message, refresh/reopen, rename/delete or leave feedback. Local development defaults to clearly labelled demo.
4. Set `EXTRACTION_DEMO_ENABLED=true` privately and restart Express for the dedicated sample. Reports: Create synthetic review sample, Run extraction, check/correct rows, Mark reviewed. Ordinary uploads cannot acquire sample values.
5. Refresh saved revision/results, request a synthetic result. It copies reviewed entries without clinical interpretation/range flags. Save a newer revision to see the old result outdated. Open a separate conversation bound to a selected review revision.
6. Download factual PDF of current reviewed data. Filter history by name/upload date/status, select reports, view a separate synthetic comparison with compatibility/missing-data limitations.
7. Settings: clear context, withdraw permission, delete all conversations with confirmation, or test password-confirmed account deletion. Individual reports delete in their details. Interrupted deletion resumes; provider/downloaded copies/backups remain separate.

## Real service and deployment

After confirming the friend's reachable origin/key, privately configure `AI_SERVICE_URL`, `AI_INTERNAL_KEY` and `CHAT_PROVIDER=fastapi` and/or `EXTRACTION_PROVIDER=fastapi`. React never accesses Ollama directly. Synthetic transport/schema tests do not validate live inference/clinical accuracy. Development-mode chat fallback is rejected; symptom fallback provenance is missing. No corrected-analysis endpoint is invented.

See [profile/chat](docs/profile-and-chat.md), [extraction/review](docs/extraction-review.md), [results/context](docs/report-results.md), [history/PDF](docs/history-and-export.md) and [privacy/deployment preparation](docs/privacy-and-deployment.md). `EXPORT_FONT_PATH` is a readable local font (Windows Arial/Linux DejaVu defaults). Unsupported glyphs produce an explicit error; original HTML stays available. Complex bidi/PDF tagging is not verified. No public/permanent export copies.

Production defaults `CHAT_PROVIDER=off`; demo chat/extraction are rejected. Deployment needs HTTPS, same-origin routing, protected MongoDB, durable private originals, fonts and reviewed proxy/backup/recovery procedures. Nothing is automatically deployed.

## Checks

```powershell
cd server
npm.cmd test
cd ../client
npm.cmd test
npm.cmd run lint
npm.cmd run build
```
Server tests own disposable MongoDB/private storage, never read `.env` or clear your database. Files run sequentially to bound disk/process use. The first install/test may download the official test MongoDB binary. CI uses synthetic tests without production credentials. Low temporary disk space can prevent startup; use a sufficiently sized temporary directory without deleting unrelated files.

For isolated browser tests, run `node scripts/browser-test-server.js` from server instead of your real backend; it owns temporary data. Optional `BROWSER_TEST_PORT`/`BROWSER_TEST_ORIGIN` allow separate ports with matching Vite `API_PROXY_TARGET`. Stop it after testing. Verification/merge order are in status. The friend maintains [AI setup](ai-backend/README.md); starting that alone does not enable adapters. Email verification, password reset, malware scanning and distributed scaling are not implemented.
