# AI-Based Chatbot For Disease Detection & Medical Report Investigation

An intelligent clinical decision support and patient guidance system integrating local generative AI (Ollama `llama3.2:3b`), OCR document processing (Tesseract + PyMuPDF), a deterministic triage safety engine, an Express.js API gateway with MongoDB sessions, and a modern React 19 web interface.

---

## 🏛️ System Architecture

This repository is structured as a coordinated multi-service architecture:

```
BackEnd/
├── ai-backend/            # [Service 1] Python FastAPI AI engine & OCR processor (Port 8000)
│   ├── app/               # Application routes, services, models, and core logic
│   ├── tests/             # Automated test suite (pytest)
│   └── requirements.txt   # Python dependencies
├── server/                # [Service 2] Node.js Express API gateway, MongoDB auth & sessions (Port 5000)
│   ├── src/               # Express app, auth routes, models, security middleware
│   └── package.json       # Express dependencies
├── client/                # [Service 3] React 19 + Vite 8 frontend web application (Port 5173)
│   ├── src/               # React UI screens (Auth, Chat), components, assets
│   └── package.json       # Frontend dependencies
├── docs/                  # Shared integration agreements & auth setup guides
├── pytest.ini             # Unified test configuration
├── pyrightconfig.json     # Python static type checking configuration
├── sample_api_responses.json # Agreed API contract between AI and frontend services
└── start_backend.bat      # One-click launcher for the AI service
```

---

## 🔌 Service Matrix & Ports

| Component | Stack | Default URL / Port | Purpose |
| :--- | :--- | :--- | :--- |
| **Medical AI Backend** | FastAPI / Python 3.11 | `http://localhost:8000` | Clinical symptom assessment, emergency triage, OCR extraction, lab explanations |
| **API Docs (Swagger)** | OpenAPI / Swagger UI | `http://localhost:8000/docs` | Interactive API testing and schema documentation |
| **API Gateway / Auth** | Express.js / Node.js | `http://localhost:5000` | User accounts, session management, CSRF protection, and gateway proxy |
| **Frontend UI** | React 19 / Vite 8 | `http://localhost:5173` | Interactive patient chat, report uploader, and visualization |

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* **Python 3.11+**
* **Ollama** installed with model `llama3.2:3b` (`ollama run llama3.2:3b`)
* **Tesseract OCR** (for image lab reports)
* **Node.js 18+ / 24+** (for Express server and React client)

---

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

### 3. Start the Express Gateway (Terminal 2)
```powershell
cd server
npm.cmd ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm.cmd run dev
```
* Express Gateway: [http://127.0.0.1:5000](http://127.0.0.1:5000)
* Liveness: [http://127.0.0.1:5000/api/health](http://127.0.0.1:5000/api/health)
* Readiness: [http://127.0.0.1:5000/api/ready](http://127.0.0.1:5000/api/ready)
* Run Tests: `npm.cmd test`

---

### 4. Start the React Client (Terminal 3)
```powershell
cd client
npm.cmd ci
npm.cmd run dev
```
* Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🔒 Security & Clinical Guardrails
* **Red-Flag Interceptors**: Immediate rule-based detection for critical symptoms (e.g., myocardial infarction, acute stroke, critical thrombocytopenia) bypassing model latency.
* **Range Validation**: Deterministic numerical comparison against clinical standard bounds with automatic decimal-shift and OCR error recovery.
* **Internal Authentication**: Secured via internal API key header (`X-Internal-Key`) for service-to-service communication.
* **Session Security**: Cookie-based sessions with HTTP-only flags, SameSite strict enforcement, and CSRF token verification.
