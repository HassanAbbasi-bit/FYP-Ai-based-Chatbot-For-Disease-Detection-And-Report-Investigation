# AI-Based Chatbot For Disease Detection & Medical Report Investigation

An intelligent clinical decision support and patient guidance system integrating local generative AI (Ollama `llama3.2:3b`), OCR document processing (Tesseract + PyMuPDF), a deterministic triage safety engine, an Express.js API gateway, and a modern React 19 web interface.

---

## 🏛️ System Architecture

This repository is structured as a coordinated multi-service architecture:

```
BackEnd/
├── ai-backend/            # [Service 1] Python FastAPI AI engine & OCR processor (Port 8000)
│   ├── app/               # Application routes, services, models, and core logic
│   ├── tests/             # Automated test suite (pytest)
│   └── requirements.txt   # Python dependencies
├── server/                # [Service 2] Node.js Express.js API gateway / server (Port 5000)
│   └── src/index.js       # Gateway entry point and health routing
├── client/                # [Service 3] React 19 + Vite 8 frontend web application (Port 5173)
│   └── src/               # React UI components, pages, and assets
├── pytest.ini             # Unified test configuration
├── pyrightconfig.json     # Python static type checking configuration
├── sample_api_responses.json # Agreed API contract between AI and frontend services
└── LICENSE                # MIT License
```

---

## 🔌 Service Matrix & Ports

| Component | Stack | Default URL / Port | Purpose |
| :--- | :--- | :--- | :--- |
| **Medical AI Backend** | FastAPI / Python 3.11 | `http://localhost:8000` | Clinical symptom assessment, emergency triage, OCR extraction, lab explanations |
| **API Docs (Swagger)** | OpenAPI / Swagger UI | `http://localhost:8000/docs` | Interactive API testing and schema documentation |
| **API Gateway** | Express.js / Node.js | `http://localhost:5000` | Gateway middleware and service coordinator |
| **Frontend UI** | React 19 / Vite 8 | `http://localhost:5173` | Interactive patient chat, report uploader, and visualization |

---

## 🚀 Quick Start Guide

### 1. Prerequisites
* **Python 3.11+**
* **Ollama** installed with model `llama3.2:3b` (`ollama run llama3.2:3b`)
* **Tesseract OCR** (for image lab reports)
* **Node.js 18+** (for Express server and React client)

### 2. Start the AI Backend (FastAPI)
```powershell
# From the repository root:
.\.venv\Scripts\Activate.ps1

# Start the server:
uvicorn app.main:app --app-dir ai-backend --host 0.0.0.0 --port 8000 --reload
```
* Interactive Swagger Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
* Health check: [http://localhost:8000/api/health](http://localhost:8000/api/health)
* Sample contract: [http://localhost:8000/api/sample/contract](http://localhost:8000/api/sample/contract)

### 3. Run Automated Tests
From the repository root, run:
```powershell
.\.venv\Scripts\python.exe -m pytest
```

### 4. Start the Express Gateway (Optional)
```bash
cd server
npm install
npm run dev
```

### 5. Start the React Client
```bash
cd client
npm install
npm run dev
```

---

## 🔒 Security & Clinical Guardrails
* **Red-Flag Interceptors**: Immediate rule-based detection for critical symptoms (e.g., myocardial infarction, acute stroke, critical thrombocytopenia) bypassing model latency.
* **Range Validation**: Deterministic numerical comparison against clinical standard bounds with automatic decimal-shift and OCR error recovery.
* **Internal Authentication**: Secured via internal API key header (`X-Internal-Key`) for service-to-service communication.
