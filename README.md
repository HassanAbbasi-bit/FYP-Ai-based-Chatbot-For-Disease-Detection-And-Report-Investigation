# AI Health Assistant

Current checkpoint: MongoDB-backed accounts, conversations, and private PDF/JPEG/PNG uploads with history, image previews, authenticated downloads and recoverable deletion. Report analysis is not connected. Replies remain clearly labelled DEMO. The friend's AI service is untouched.

## Folders

- `client/`: React/Vite screens and relative `/api` requests (Hassan).
- `server/`: Express, Mongoose users/conversations/messages/request records, MongoDB sessions (Hassan).
- `ai-backend/`: friend's Python/FastAPI/Ollama service; maintained separately and not connected to Express yet.
- `docs/`: shared setup and API agreements.

## One-time setup

Use Node.js 24 (tested runtime: 24.15.0). From the project root:

```powershell
cd client
npm.cmd ci
cd ../server
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

The first server dependency install/test may download an official MongoDB binary for isolated tests. This is not a permanent local database installation and does not configure your application database.

Edit **server/.env privately**. Never send its contents in chat or commit it. Set `MONGODB_URI` to your own MongoDB connection string and an explicit application database such as `fyp_auth`. Preserve existing valid settings. MongoDB must be an Atlas cluster or replica set supporting transactions; a standalone local database is insufficient. No new credentials are required for this checkpoint. See [conversation setup and API](docs/conversations.md).

Generate your own session secret locally:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste that output into `SESSION_SECRET` in `.env` when setting up from the example. An existing local `.env` prepared by the checkpoint already has a generated secret; preserve it. Keep `APP_ORIGIN=http://localhost:5173`, `NODE_ENV=development`, and `PORT=5000` for local development. Use exactly localhost:5173 in your browser so the Origin check matches. Leave `TRUST_PROXY` unset.

See [database and authentication setup](docs/authentication.md) for local MongoDB and Atlas options. This code validates configuration at startup and exits with a safe message if database initialization fails. After startup, MongoDB outages produce HTTP 503; liveness stays separate from readiness.

## Two development terminals

Terminal 1, from the project root:

```powershell
cd server
npm.cmd run dev
```

Terminal 2, from the project root:

```powershell
cd client
npm.cmd run dev
```

Open http://localhost:5173. Express is bound to http://127.0.0.1:5000. Liveness: http://127.0.0.1:5000/api/health. Database readiness: http://127.0.0.1:5000/api/ready. `npm.cmd` avoids PowerShell's npm.ps1 policy issue; other shells can use `npm`.

Register an account using a 15–128 character password, choose New chat, send a synthetic test message, and refresh to reopen saved history. Use the sidebar to switch, rename, or permanently delete conversations. Sign-out clears the browser's account state while saved conversations remain private to the owning account. Messages are stored in MongoDB, never localStorage/sessionStorage. Unsaved drafts remain only in memory. The interface explains persistence and requires confirmation for deletion.

Choose Reports after login, upload a synthetic PDF/JPEG/PNG, refresh, reopen, preview/download and confirm deletion. Default storage is created automatically; existing credentials need no changes. See [report setup and API](docs/reports.md) and [report validation](docs/report-checkpoint-validation.md).

## Checks

```powershell
cd server
npm.cmd test
cd ../client
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Tests always create their own disposable MongoDB replica set. They never read `.env` or use a supplied database URI. If MongoDB's official binary cannot be downloaded or started, integration tests fail rather than silently passing with mocked persistence. No user database is cleared.

For browser verification without configuring your real database, run `node scripts/browser-test-server.js` from `server/` instead of the normal Express command. It binds port 5000 and uses a disposable MongoDB with an ephemeral session secret. Use test accounts only; stopping it removes its database. It is not the normal application setup.

## Limits and next work

This remains a development foundation, not a production-readiness or security certification. No email verification, password recovery, report extraction/OCR, health profiles, real AI/Ollama integration, streaming, or clinical features are implemented. No password-reset or social-login buttons are shown. Retry recovery is user-driven; unsaved drafts do not survive refresh. Deletion removes live application records, not provider backups. See [persistence, retry, deletion and limitations](docs/conversations.md) and [actual validation](docs/conversation-checkpoint-validation.md).

Production needs HTTPS, an exact HTTPS `APP_ORIGIN`, private secrets, protected MongoDB access, a same-origin `/api` reverse proxy, and deployment-specific review. Vite's development proxy is not a production reverse proxy. In-process rate limits reset on restart and must be replaced with a shared store before running multiple instances.

Next checkpoint: verify the supplied [AI integration agreement](docs/ai-integration-contract.md) with your friend, then implement and verify a bounded Express-to-FastAPI adapter. Do not expose AI credentials or connect React directly to Ollama.

## Separate AI backend

The friend-provided AI service is now included under `ai-backend/`. Its setup and dependencies are documented in [its README](ai-backend/README.md). Starting it does not connect the React/Express demo chat or uploaded reports to AI. No live inference or clinical validation was performed during this conflict resolution.

### 2. Start the AI Backend (Terminal 1)
```powershell
# From the repository root (or double-click start_backend.bat):
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --app-dir ai-backend --host 0.0.0.0 --port 8000 --reload
```
* **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health)
* **Agreed Contract**: [http://localhost:8000/api/sample/contract](http://localhost:8000/api/sample/contract)
* **Run Tests**: `pytest`

---
