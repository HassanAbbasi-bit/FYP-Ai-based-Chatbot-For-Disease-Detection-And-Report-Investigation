# AI Health Assistant

Current checkpoint: MongoDB-backed accounts and cookie sessions around the working demonstration chat. The friend's AI service is untouched.

## Folders

- `client/`: React/Vite screens and relative `/api` requests (Hassan).
- `server/`: Express, Mongoose users, MongoDB sessions (Hassan).
- `ai-service/`: friend's planned Python/FastAPI/Ollama implementation; absent from this branch.
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

Edit **server/.env privately**. Never send its contents in chat or commit it. Set `MONGODB_URI` to your own MongoDB connection string. Choose an explicit application database such as `fyp_auth`. No database is configured by this checkpoint.

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

Register an account using a 15–128 character password, send a test message, refresh to confirm you stay signed in, then sign out. Your chat is held only in memory and disappears on refresh, logout, session expiry, or account changes. No health content is stored in browser storage or MongoDB.

## Checks

```powershell
cd server
npm.cmd test
cd ../client
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Tests always create their own disposable MongoDB process. They never read `.env` or use a supplied database URI. If MongoDB's official binary cannot be downloaded or started, integration tests fail rather than silently passing with mocked persistence. No user database is cleared.

For browser verification without configuring your real database, run `node scripts/browser-test-server.js` from `server/` instead of the normal Express command. It binds port 5000 and uses a disposable MongoDB with an ephemeral session secret. Use test accounts only; stopping it removes its database. It is not the normal application setup.

## Limits and next work

This remains a development foundation, not a production-readiness or security certification. No email verification, password recovery, MongoDB conversation persistence, report uploads, health profiles, real AI/Ollama integration, streaming, or clinical features are implemented. No password-reset or social-login buttons are shown.

Production needs HTTPS, an exact HTTPS `APP_ORIGIN`, private secrets, protected MongoDB access, a same-origin `/api` reverse proxy, and deployment-specific review. Vite's development proxy is not a production reverse proxy. In-process rate limits reset on restart and must be replaced with a shared store before running multiple instances.

Next checkpoint: validate your privately configured database, then confirm the [AI integration agreement](docs/ai-integration-contract.md) with your friend before implementing an Express-to-FastAPI adapter.
