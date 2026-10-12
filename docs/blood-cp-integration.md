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

1. Run Ollama and ensure the model exists: `ollama pull llama3.2:3b` (one-time download). If Ollama is not running, use `ollama serve` in its own terminal.
2. Tesseract OCR is needed for images and scanned PDFs. Configure `TESSERACT_CMD` privately in `ai-backend/.env` if its installation differs from the automatically detected Windows path.
3. Keep your MongoDB URI and session secret in `server/.env`. Run `node scripts/configure-local-ai.cjs` from the project root to set both FastAPI providers and save matching random private keys. Existing database credentials are preserved. This script refuses to replace an existing nonlocal AI deployment.
4. Double-click `start_project.bat`. It starts FastAPI on 127.0.0.1:8000, Express on 127.0.0.1:5000, and Vite on localhost:5173. Open http://localhost:5173.
5. Sign in, open Settings, enable chat and report processing consent and save. In Reports, upload an image/PDF, run extraction, check/correct entries, mark reviewed, then interpret the reviewed report or open its conversation.

The dashboard separately shows configured integration, backend reachability, installed/running model readiness and OCR readiness. Model inference can take longer than an ordinary API call; deadlines and processing leases accommodate the supplied 120-second model timeout. Cancellation is local and does not claim to cancel provider inference.

For a fresh checkout, install Node dependencies in `server` and `client`. Create `.venv` using Python 3.12+, then install `ai-backend/requirements-runtime.txt`. Full optional development/retrieval dependencies remain in `ai-backend/requirements.txt`; the implemented routes do not depend on a Chroma database. Do not commit `.env`, originals, model files or virtual environments.

## New reviewed-data contract

`POST /api/reports/reviewed/explain`: `{report_id, review_version, rows}`. Each nonremoved row contains `id,testName,rawValue,units,referenceRange,reportDate,unknown,unreadable`. Responses identify the same report/revision, model provenance, summary, findings, flags by row ID, discussion questions and disclaimer. Unknown/comparator/qualitative values and unrecognized ranges are inconclusive; reviewed values/ranges are never automatically rescaled.

`POST /api/reports/reviewed/chat` adds `{message,conversation_id,history}` to that reviewed payload. It is stateless and never reads another report from the legacy process-wide cache. Current account, consent and review revision are rechecked before publishing results. Missing models, invalid revisions and late responses cannot become successful saved interpretations.

Reviewed endpoints are registered before the legacy dynamic `/reports/{report_id}/explain` route. Authentication requires the matching private key even in debug mode. Provider errors are mapped to bounded public messages without private request contents.

## Verification

Tests use disposable MongoDB databases, synthetic reports/accounts and local stub model output. They cover corrected-data transfer, removed/unknown rows, report chat, revision mismatch, unavailable models, late-publication fencing, authentication, privacy and existing application regressions. Browser checks cover desktop/mobile layout and account/report workflows. Live OCR is additionally verified with a generated image containing synthetic CBC entries; this is software verification, not a medical evaluation.

### Checked on this computer, 12 October 2026

- 108 existing server tests and 4 new reviewed-AI integration tests passed; 19 FastAPI tests and 14 frontend tests passed. Frontend lint/build passed. Twelve Chrome browser workflows passed, including desktop/mobile overflow and privacy controls.
- Ollama and Tesseract installed successfully. Real HTTP image extraction returned four synthetic CBC rows with a missing date left null.
- The llama3.2:3b model download failed after registry connection timeouts. The service is reachable, but the model is not installed/ready; live inference has not been verified. Retry `ollama pull llama3.2:3b` when the network can reach the Ollama model registry.
- Existing MongoDB credentials were preserved. The Atlas connection failed with network timeouts to all configured members; this was not an authentication rejection. Check cluster availability, Atlas current-IP access, and network connectivity, then restart Express. Do not replace credentials based only on this network error.
