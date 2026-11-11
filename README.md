# Medical Chatbot & Clinical Report Analyzer (BackEnd)

An enterprise-grade clinical decision support and patient guidance backend service. The platform integrates local generative AI (Ollama `llama3.2:3b`), OCR document processing (Tesseract + PyMuPDF), a deterministic clinical triage safety engine, and an Express.js API gateway with MongoDB authentication and session management.

---

## 🏛️ System Architecture

This repository operates as a coordinated multi-service backend architecture:

```
BackEnd/
├── ai-backend/            # [Service 1] Python FastAPI AI engine & OCR processor (Port 8000)
│   ├── app/               # Application routes, services, models, and core logic
│   │   ├── api/routes/    # Endpoints: health, chat, symptoms, reports, reviewed
│   │   ├── services/      # Ollama client, OCR parser, range checker, triage engine
│   │   └── models/        # Pydantic schemas and clinical data contracts
│   ├── requirements.txt   # Python full dependencies
│   └── requirements-runtime.txt # Lean runtime dependencies
├── server/                # [Service 2] Node.js Express API gateway (Port 5000)
│   ├── src/               # Express app, auth routes, models, security middleware
│   │   ├── routes/        # Auth, account, conversations, reports, symptoms, feedback
│   │   ├── services/      # AI gateway proxy, storage, validation worker, sessions
│   │   └── models/        # Mongoose schemas (User, Report, Extraction, Analysis, etc.)
│   └── package.json       # Node.js dependencies
├── docs/                  # Streamlined system documentation
│   ├── blood-cp-integration.md # Local startup, Ollama store, and verification guide
│   ├── architecture-and-api.md # System architecture, data flows, and full API reference
│   └── security-and-privacy.md # Auth, CSRF, rate limits, consent, and clinical safety
├── pyrightconfig.json     # Python static type checking configuration
├── start_backend.bat      # One-click launcher for FastAPI AI backend
├── start_ollama.bat       # Launcher for local Ollama LLM
└── start_project.bat      # Coordinated launcher (Ollama + FastAPI + Express + Client)
```

---

## 🔌 Service Matrix & Ports

| Component | Stack | Default URL / Port | Purpose |
| :--- | :--- | :--- | :--- |
| **Medical AI Backend** | FastAPI / Python 3.11+ | `http://localhost:8000` | Symptom assessment, red-flag triage, OCR extraction, lab explanations |
| **API Docs (Swagger)** | OpenAPI / Swagger UI | `http://localhost:8000/docs` | Interactive API testing and schema documentation |
| **API Gateway / Auth** | Express.js / Node.js | `http://localhost:5000` | User accounts, session management, CSRF protection, and gateway proxy |
| **Local LLM Engine** | Ollama (`llama3.2:3b`) | `http://localhost:11434` | Private, on-device generative reasoning and clinical summaries |
| **Database** | MongoDB (Local / Atlas) | `mongodb://localhost:27017` | Persistent users, sessions, extractions, and reviewed analyses |

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* **Python 3.11+**
* **Node.js 18+ / 24+**
* **Ollama** installed with model `llama3.2:3b` (`ollama pull llama3.2:3b`)
* **Tesseract OCR** (for image lab reports)
* **MongoDB** (local community server or MongoDB Atlas URI)

---

### 2. Start Ollama (Terminal 1)
```powershell
# Using the project launcher (configures model storage and starts serve):
.\start_ollama.bat
```

---

### 3. Start the AI Backend (Terminal 2)
```powershell
# From the repository root (or double-click start_backend.bat):
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --app-dir ai-backend --host 0.0.0.0 --port 8000 --reload
```
* **Interactive Swagger Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

### 4. Start the Express Gateway (Terminal 3)
```powershell
cd server
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
```
* **Express Gateway**: [http://127.0.0.1:5000](http://127.0.0.1:5000)
* **Liveness Probe**: [http://127.0.0.1:5000/api/health](http://127.0.0.1:5000/api/health)
* **Readiness Probe**: [http://127.0.0.1:5000/api/ready](http://127.0.0.1:5000/api/ready)

*Tip: You can start all services simultaneously with `start_project.bat`.*

---

## 🤝 API Contract & Endpoints

### FastAPI AI Engine (Port 8000)

All inter-service AI requests require the `X-Internal-Key` header matching `AI_BACKEND_INTERNAL_KEY`.

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/health` | `GET` | Health status of FastAPI, GPU, and Ollama connection |
| `/api/chat` | `POST` | Chat processing with conversational history and emergency triage |
| `/api/symptoms/assess` | `POST` | Symptom intake, red-flag rule check, and calibrated causes |
| `/api/reports/extract` | `POST` | Upload PDF/image report, OCR parsing, structured lab tests, and range flags |
| `/api/reports/reviewed/explain` | `POST` | Grounded interpretation of user-reviewed and corrected lab rows |
| `/api/reports/reviewed/chat` | `POST` | Context-bound Q&A restricted exclusively to reviewed report findings |
| `/api/reports/{id}/explain` | `POST` | Legacy extraction explanation fallback |

### Express API Gateway (Port 5000)

| Endpoint Group | Path | Methods | Description |
| :--- | :--- | :--- | :--- |
| **Authentication** | `/api/auth/register`, `/login`, `/logout`, `/session`, `/csrf` | `GET`, `POST` | Argon2id auth, session lifecycle, CSRF tokens |
| **Account & Privacy** | `/api/account`, `/profile`, `/consent` | `GET`, `PATCH`, `DELETE` | Profile updates, granular AI consents, account erasure |
| **Conversations** | `/api/conversations`, `/:id/messages` | `GET`, `POST`, `DELETE` | Persisted patient chats with server-side AI routing |
| **Symptoms** | `/api/symptoms/assess` | `POST` | Gateway proxy to AI symptom assessor with consent check |
| **Reports & OCR** | `/api/reports`, `/:id/file`, `/:id/extract` | `GET`, `POST`, `DELETE` | Secure file upload, OCR extraction, row editing |
| **Reviewed Analysis** | `/api/reports/:id/analysis`, `/:id/conversation` | `GET`, `POST` | Interpretation and Q&A on user-verified lab data |
| **Feedback** | `/api/feedback` | `POST` | User feedback collection |

---

## 🔒 Security & Clinical Guardrails

* **Red-Flag Interceptors**: Immediate rule-based detection for critical symptoms (e.g., chest pain, acute neurological deficits, severe thrombocytopenia) bypassing model latency.
* **Range Validation**: Deterministic numerical comparison against clinical standard bounds with automatic decimal-shift and OCR error recovery.
* **Internal Authentication**: Secured via internal API key header (`X-Internal-Key`) for service-to-service communication; private keys and database URIs are never exposed to browser clients.
* **Session Security**: Cookie-based sessions with HTTP-only flags, SameSite strict enforcement, and CSRF token verification.
* **Privacy & Granular Consent**: Explicit user opt-ins required for AI chat and medical report analysis; full GDPR-aligned account erasure supported.

---

## 📚 Documentation

For in-depth operational and architectural specifications, see the `docs/` folder:

* [**Local Startup & Ollama Guide**](docs/blood-cp-integration.md) — Step-by-step setup, model storage on drive F, Tesseract configuration, and verification tests.
* [**Architecture & API Reference**](docs/architecture-and-api.md) — Multi-service topology, inter-service security, and comprehensive endpoint request/response contracts.
* [**Security, Privacy & Clinical Safety**](docs/security-and-privacy.md) — Argon2id hashing, CSRF sync, rate limiting, patient consent governance, and clinical safety boundaries.
