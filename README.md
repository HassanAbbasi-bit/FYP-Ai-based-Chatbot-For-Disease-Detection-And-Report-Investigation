# AI Health Assistant

Development checkpoint: React → Express → React demonstration chat.

## Repository responsibilities

- `client/`: React and Vite interface (Hassan).
- `server/`: Express API; future MongoDB integration (Hassan). No database is connected yet.
- `ai-service/`: planned Python/FastAPI/Ollama service (friend). It is not present on this branch. Keep its implementation separate; this checkpoint does not change it.
- `docs/`: shared setup and API agreements.

## Install and run

Use Node.js 24 (the checkpoint was tested with 24.15.0). From the repository root, install the locked dependencies:

```powershell
cd client
npm.cmd ci
cd ../server
npm.cmd ci
```

Keep two terminals open, starting from the repository root.

Terminal 1 — Express:

```powershell
cd server
npm.cmd run dev
```

Terminal 2 — React:

```powershell
cd client
npm.cmd run dev
```

Open http://localhost:5173. Express listens locally at http://127.0.0.1:5000. Health check: http://127.0.0.1:5000/api/health. Vite forwards relative `/api` calls to Express. `npm.cmd` avoids the PowerShell npm.ps1 execution-policy issue on Windows; other shells can use `npm`.

## Try the checkpoint

Click **Check server connection**, then send `Hello`. You should see your message and a response labelled as a demonstration. Stop Express, send another test message, then restart Express and click **Retry message**. The existing user bubble is reused; a successful reply is added once.

Messages exist only in React memory. Refreshing clears them. No localStorage, database, or chat-content logging is used. Only one request can be in flight. Chat requests time out after 15 seconds; health checks after 5 seconds. Use test content.

`POST /api/chat` accepts `{"message":"Hello"}`. Messages must be non-blank strings of at most 2,000 characters. The server returns `{ "mode": "demo", "reply": "Test reply: Express received your message. The AI service is not connected yet, so no medical analysis has been performed." }`. Invalid messages and malformed JSON return structured HTTP 400 errors; bodies above 100 KB return HTTP 413.

## Checks

```powershell
cd server
npm.cmd test
cd ../client
npm.cmd run lint
npm.cmd run build
```

The server tests start an isolated local server on a temporary port. The client build creates ignored `client/dist/` output. This is a development setup: production hosting must provide an API reverse proxy or same-origin Express routing; Vite's development proxy is not a production deployment configuration.

## Current limitations and next work

No AI/Ollama connection, diagnoses, report investigation, uploads, authentication, MongoDB persistence, streaming, or conversation context is implemented. A retry can repeat an HTTP request after a timeout; the stateless demo has no side effects. Before adding real AI requests, agree on retry/idempotency behavior with the service owner.

Next checkpoint: confirm the [AI integration contract](docs/ai-integration-contract.md), then replace the demo service with an Express-to-FastAPI adapter, including timeout and error handling. React should continue calling Express rather than Ollama directly.
