# Blood CP integration and local startup

The React application connects to Express through `/api`. Express authenticates the account, enforces ownership and consent, and forwards permitted data to the local FastAPI service using a private internal key. Browser code never receives that key or a MongoDB URI.

## Available application workflows

- General AI conversation with saved account history, follow-up questions and service urgency.
- Symptom assessment with possible causes, doctor discussion questions and immediate rule-based escalation. An unavailable model returns a visible error instead of generic disease guesses.
- Private PDF/PNG/JPEG upload, original preview/download, OCR/table extraction, preserved original entries and versioned user corrections.
- AI interpretation of a saved reviewed revision: summary, individual findings, exact supplied-range comparisons and questions for the doctor.
- Report-specific AI conversations using the selected reviewed revision and the user's actual question. Correcting the report makes prior results/conversations visibly outdated.
- History, privacy/consent controls, feedback and factual reviewed-data PDF export continue to work.

The supplied AI backend has no implemented longitudinal comparison or doctor-visit-summary endpoint. Comparison remains a clearly separated synthetic demonstration; the factual PDF exports reviewed entries. Generated citations from the legacy cache endpoint are not presented as verified retrieval evidence. Diagnosis and clinical accuracy are not certified by integration tests.

## Start on this computer

1. Run `start_ollama.bat` (or `start_project.bat`) to use the project model store on drive F. Ensure the model exists: `ollama pull llama3.2:3b` (one-time download). The launcher starts Ollama when needed; model binaries are in `ai-backend/.ollama-models/` and are ignored by Git.
2. Tesseract OCR is needed for images and scanned PDFs. Configure `TESSERACT_CMD` privately in `ai-backend/.env` if its installation differs from the automatically detected Windows path.
3. Keep your MongoDB URI and session secret in `server/.env`. Run `node scripts/configure-local-ai.cjs` from the project root to set both FastAPI providers and save matching random private keys. Existing database credentials are preserved. This script refuses to replace an existing nonlocal AI deployment.
4. Double-click `start_project.bat`. It starts Ollama if needed, FastAPI on 127.0.0.1:8000, Express on 127.0.0.1:5000, and Vite on localhost:5173. Open http://localhost:5173.
5. Sign in, open Settings, enable chat and report processing consent and save. In Reports, upload an image/PDF, run extraction, check/correct entries, mark reviewed, then interpret the reviewed report or open its conversation.

The dashboard separately shows configured integration, backend reachability, installed/running model readiness and OCR readiness. Model inference can take longer than an ordinary API call; deadlines and processing leases accommodate a 480-second local model timeout with longer Express/client deadlines and publication leases. Cancellation is local and does not claim to cancel provider inference.

For a fresh checkout, install Node dependencies in `server` and `client`. Create `.venv` using Python 3.12+, then install `ai-backend/requirements-runtime.txt`. Full optional development/retrieval dependencies remain in `ai-backend/requirements.txt`; the implemented routes do not depend on a Chroma database. Do not commit `.env`, originals, model files or virtual environments.

## New reviewed-data contract

`POST /api/reports/reviewed/explain`: `{report_id, review_version, rows}`. Each nonremoved row contains `id,testName,rawValue,units,referenceRange,reportDate,unknown,unreadable`. Responses identify the same report/revision, model provenance, summary, findings, flags by row ID, discussion questions and disclaimer. Unknown/comparator/qualitative values and unrecognized ranges are inconclusive; reviewed values/ranges are never automatically rescaled.

`POST /api/reports/reviewed/chat` adds `{message,conversation_id,history}` to that reviewed payload. It is stateless and never reads another report from the legacy process-wide cache. Current account, consent and review revision are rechecked before publishing results. Missing models, invalid revisions and late responses cannot become successful saved interpretations.

Reviewed endpoints are registered before the legacy dynamic `/reports/{report_id}/explain` route. Authentication requires the matching private key even in debug mode. Provider errors are mapped to bounded public messages without private request contents.

## Verification

Tests use disposable MongoDB databases, synthetic reports/accounts and local stub model output. They cover corrected-data transfer, removed/unknown rows, report chat, revision mismatch, unavailable models, late-publication fencing, authentication, privacy and existing application regressions. Browser checks cover desktop/mobile layout and account/report workflows. Live OCR is additionally verified with a generated image containing synthetic CBC entries; this is software verification, not a medical evaluation.

### Current local verification

- All 113 server tests, 22 FastAPI tests and 14 frontend tests passed; frontend lint and production build passed.
- The original llama3.2:3b model is installed. Actual model chat, symptom assessment, image OCR, correction, saved reviewed-report interpretation and report-specific conversation have passed live checks using synthetic data.
- Atlas connected and Express readiness passed after the current IP was added to Atlas Network Access. Existing database credentials were preserved.
- During local inference, the disposable test database briefly returned 503. Status reads recover without resubmitting inference; the interface clears a recovered status-read error while retaining action errors.
- Live Chrome checks passed: real image OCR, corrected reviewed findings, doctor questions, report conversation containing 13.0, symptoms, mobile overflow and recovery from a simulated status outage; zero page errors.
- These results supersede the earlier model-download and Atlas network failures. Tests verify software behavior, not clinical accuracy.

## Runtime reliability fixes

A reproduced Ollama HTTP 500 reported failure to allocate the approximately 2 GB CPU model buffer. Drive C had only about 230 MB free and RAM was heavily occupied. The existing 1.9 GB model store was moved intact to drive F, recovering about 2 GB on C without touching account data. Ollama's model directory and the local launcher now use the preserved F-drive store.

Context memory scales with reviewed report size; short requests share a 4K context and report prompts omit internal IDs and empty metadata. Excessively large context is rejected explicitly rather than silently truncated. Cold loading on this CPU was measured at about 45 seconds, with the first streamed token arriving around 66 seconds. Request deadlines and publication leases now accommodate this startup time.

Reviewed explanations use Ollama JSON-schema constrained output and Pydantic validation. Valid JSON alone is insufficient: required field types and reviewed test identity must match. Invalid output is INVALID_MODEL_OUTPUT (502); a model timeout is MODEL_TIMEOUT (504); unavailable-model errors remain separate. No failed result is replaced with fabricated findings.

To run an explicit live check, generate the synthetic image with `python scripts/verify-live-ocr.py`, then run `node scripts/verify-live-ai.js` from server/. The live check uses the actual model and a disposable database, never the configured Atlas account records.
