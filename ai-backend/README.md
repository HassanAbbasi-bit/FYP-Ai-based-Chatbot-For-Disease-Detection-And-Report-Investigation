# Medical AI Backend Service (Friend 1)

This service powers the AI backend for the Medical Chatbot & Lab Report Analyzer. It handles symptom analysis, red-flag triage, lab report extraction, automated range checks, and grounded clinical explanations.

---

## 🚀 Quick Start

### 1. Activate Virtual Environment
```powershell
.\.venv\Scripts\Activate.ps1
```

### 2. Start the FastAPI Development Server
```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```
* **Interactive API Documentation (Swagger)**: [http://localhost:8000/docs](http://localhost:8000/docs)
* **Agreed Sample API Contract for Friend 2**: [http://localhost:8000/api/sample/contract](http://localhost:8000/api/sample/contract)
* **Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health)

---

## 🤝 API Contract for Friend 2 (MERN Stack)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | `GET` | Health status of FastAPI, GPU, and Ollama connection |
| `/api/sample/contract` | `GET` | Complete agreed sample JSON responses for frontend development |
| `/api/chat` | `POST` | Chat processing with conversational history and emergency triage |
| `/api/symptoms/assess` | `POST` | Symptom intake, red-flag rule check, and calibrated causes |
| `/api/reports/extract` | `POST` | Upload PDF/image report, OCR parsing, structured lab tests, and range flags |
| `/api/reports/{id}/explain` | `POST` | Grounded report explanations and doctor visit questions |

---

## 🧪 Automated Testing
Run the test suite with:
```powershell
.\.venv\Scripts\python.exe -m pytest tests/test_api.py -v
```
