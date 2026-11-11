# Architecture & API Reference

This document details the multi-service architecture, inter-service authentication protocols, data flow lifecycles, and complete API specifications for the Medical Chatbot and Lab Report Investigation platform.

---

## 🏛️ System Architecture & Network Topology

The system separates client authentication and persistence from AI processing and optical character recognition:

```
+-----------------------------------------------------------------------+
|                           Client Browser                              |
|          React SPA (Port 5173) / Authenticated User Session           |
+-----------------------------------------------------------------------+
                                   |
                HTTP / JSON (Same-Origin or Reverse Proxy)
                Session Cookies (HTTP-Only, SameSite=Lax)
                CSRF Token Sync
                                   v
+-----------------------------------------------------------------------+
|                     Service 2: Express.js Gateway                     |
|                               (Port 5000)                             |
|  - User Registration, Login, Argon2id Passwords                       |
|  - MongoDB Session Store & Auth Lifecycles                            |
|  - Consent & Privacy Checks (aiChatConsent, reportAnalysisConsent)    |
|  - Secure Multi-part File Ingestion (Sharp & Cantoo PDF Validation)   |
|  - Rate Limiting, Origin Check & CSRF Protection                      |
+-----------------------------------------------------------------------+
          |                                            |
   Mongoose / MongoDB                         HTTP POST (JSON / Multipart)
   (Users, Reports, Sessions,                 Private Header: X-Internal-Key
   Extractions, Analyses)                     Lease / Timeout Safeguards
          |                                            |
          v                                            v
+--------------------+                 +--------------------------------+
|  MongoDB Database  |                 | Service 1: Python FastAPI AI   |
| (Local / Atlas)    |                 |           (Port 8000)          |
+--------------------+                 |  - Rule-Based Red-Flag Engine  |
                                       |  - Lab Range Checker & Bounds  |
                                       |  - Tesseract OCR & PyMuPDF     |
                                       |  - Reviewed Lab Data Contracts |
                                       +--------------------------------+
                                                       |
                                               Ollama HTTP API
                                               (Port 11434)
                                                       v
                                       +--------------------------------+
                                       |      Local Ollama Engine       |
                                       |      Model: llama3.2:3b        |
                                       |      (Private on-device LLM)   |
                                       +--------------------------------+
```

### Trust Boundaries
1. **Public / Client Boundary**: The browser communicates exclusively with the Express gateway (`http://127.0.0.1:5000`). It never accesses MongoDB or the FastAPI service directly.
2. **Inter-Service Boundary**: Express communicates with FastAPI (`http://127.0.0.1:8000`) over private HTTP calls secured with the `X-Internal-Key` header.
3. **Inference Boundary**: FastAPI connects locally to Ollama (`http://127.0.0.1:11434`). Patient health data is never transmitted to external cloud LLM providers.

---

## 🔑 Inter-Service Authentication

Communication between the Express gateway and FastAPI engine requires a shared private secret:

* **Header**: `X-Internal-Key: <AI_BACKEND_INTERNAL_KEY>`
* **Configuration**: Set in `server/.env` (`AI_BACKEND_KEY`) and `ai-backend/.env` (`AI_BACKEND_INTERNAL_KEY`).
* **Enforcement**: FastAPI rejects missing or mismatched keys with `401 Unauthorized` or `403 Forbidden` across all operational endpoints (even in debug mode).

---

## 📡 API Specification: FastAPI AI Service (Port 8000)

### 1. Health & Readiness
* **Endpoint**: `GET /api/health`
* **Auth**: None (public monitoring probe)
* **Response**:
  ```json
  {
    "status": "healthy",
    "service": "ai-backend",
    "ollama": {
      "connected": true,
      "model": "llama3.2:3b"
    },
    "gpu_available": false
  }
  ```

### 2. Conversational Chat & Triage
* **Endpoint**: `POST /api/chat`
* **Auth**: `X-Internal-Key`
* **Request Body**:
  ```json
  {
    "message": "I have been experiencing a sudden crushing chest pain radiating to my left arm.",
    "conversation_id": "conv_123456",
    "history": [
      {"role": "user", "content": "Hello doctor"},
      {"role": "assistant", "content": "Hello! How can I assist you today?"}
    ]
  }
  ```
* **Response**:
  ```json
  {
    "reply": "CRITICAL EMERGENCY: Your symptoms suggest a potential cardiac emergency...",
    "suggested_follow_ups": ["Call 911 / emergency services immediately"],
    "urgency_level": "emergency",
    "disclaimer": "This information is generated by an AI assistant for educational purposes..."
  }
  ```

### 3. Symptom Intake & Assessment
* **Endpoint**: `POST /api/symptoms/assess`
* **Auth**: `X-Internal-Key`
* **Request Body**:
  ```json
  {
    "symptoms": "High fever, persistent dry cough, and mild shortness of breath",
    "duration": "3 days",
    "severity": "moderate",
    "additional_notes": "No known previous respiratory conditions"
  }
  ```
* **Response**:
  ```json
  {
    "assessment_id": "assess_987654",
    "extracted_symptoms": ["fever", "dry cough", "shortness of breath"],
    "urgency_level": "urgent",
    "is_red_flag": false,
    "escalation_message": null,
    "possible_causes": [
      {
        "condition": "Viral Lower Respiratory Infection",
        "description": "Common presentation with fever, cough, and exertion dyspnea.",
        "likelihood": "possible"
      }
    ],
    "recommended_questions_for_doctor": [
      "Should I undergo a chest X-ray or viral panel testing?",
      "What red flag symptoms should prompt emergency room presentation?"
    ],
    "self_care_notes": "Maintain hydration and rest. Monitor oxygen saturation if available.",
    "disclaimer": "This clinical triage assessment is informative and does not replace medical advice."
  }
  ```

### 4. Lab Report Document OCR Extraction
* **Endpoint**: `POST /api/reports/extract`
* **Auth**: `X-Internal-Key`
* **Request**: `multipart/form-data` with `file: <binary PDF or image>`
* **Response**:
  ```json
  {
    "report_id": "rep_abc123",
    "report_date": "2026-11-01",
    "tests": [
      {
        "name": "Hemoglobin",
        "value": 11.2,
        "unit": "g/dL",
        "reference_range": "13.5 - 17.5",
        "status": "low",
        "page": 1,
        "needs_review": false,
        "review_reason": null
      },
      {
        "name": "Platelets",
        "value": 180,
        "unit": "10^3/uL",
        "reference_range": "150 - 450",
        "status": "normal",
        "page": 1,
        "needs_review": false,
        "review_reason": null
      }
    ]
  }
  ```

### 5. Grounded Interpretation of Reviewed Lab Data
* **Endpoint**: `POST /api/reports/reviewed/explain`
* **Auth**: `X-Internal-Key`
* **Purpose**: Generates an explanation strictly bounded by user-verified and corrected lab entries.
* **Request Body**:
  ```json
  {
    "report_id": "rep_abc123",
    "review_version": 1,
    "rows": [
      {
        "id": "row_1",
        "testName": "Hemoglobin",
        "rawValue": "11.2",
        "units": "g/dL",
        "referenceRange": "13.5 - 17.5",
        "reportDate": "2026-11-01",
        "unknown": false,
        "unreadable": false
      }
    ]
  }
  ```
* **Response**:
  ```json
  {
    "report_id": "rep_abc123",
    "review_version": 1,
    "model": "llama3.2:3b",
    "summary": "Your lab results indicate mild anemia with hemoglobin below normal range.",
    "findings": [
      {
        "testName": "Hemoglobin",
        "value": "11.2 g/dL",
        "status": "low",
        "significance": "Suggestive of mild normocytic or microcytic anemia."
      }
    ],
    "flags_by_row_id": {
      "row_1": "low"
    },
    "discussion_questions": [
      "Should we check serum ferritin, iron, and total iron-binding capacity?",
      "Are dietary modifications or oral iron supplements recommended?"
    ],
    "disclaimer": "This report explanation is generated for informational support."
  }
  ```

### 6. Context-Bound Report Q&A Chat
* **Endpoint**: `POST /api/reports/reviewed/chat`
* **Auth**: `X-Internal-Key`
* **Purpose**: Allows patient to ask questions about their reviewed report without model hallucination outside the report context.
* **Request Body**:
  ```json
  {
    "report_id": "rep_abc123",
    "review_version": 1,
    "message": "Why is my hemoglobin low?",
    "conversation_id": "rep_conv_789",
    "rows": [ ... ],
    "history": [ ... ]
  }
  ```

---

## 🚪 API Specification: Express Gateway (Port 5000)

### 1. Authentication & Session Management
* `POST /api/auth/register`: Create account with email, password, and name.
* `POST /api/auth/login`: Authenticate credentials, initialize MongoDB session cookie.
* `POST /api/auth/logout`: Invalidate session and destroy cookie.
* `GET /api/auth/session`: Retrieve current authenticated user profile and active consents.
* `GET /api/auth/csrf`: Generate synchronized CSRF token for state-modifying requests.

### 2. User Account & Consent Governance
* `GET /api/account`: Fetch account metadata, storage utilization, and consent timestamps.
* `PATCH /api/account/profile`: Update user display name or demographic preferences.
* `PATCH /api/account/consent`: Update `aiChatConsent` and `reportAnalysisConsent` flags.
* `DELETE /api/account`: GDPR/HIPAA erasure — permanently purges account, sessions, files, extractions, and analyses.

### 3. Conversations (Patient Chat)
* `GET /api/conversations`: Paginated list of user conversation threads.
* `POST /api/conversations`: Create a new conversation thread.
* `GET /api/conversations/:id`: Retrieve conversation message history.
* `POST /api/conversations/:id/messages`: Send user message; forwards to AI backend if consent is granted; checks emergency red-flags.
* `DELETE /api/conversations/:id`: Soft or permanent deletion of conversation history.

### 4. Medical Report Lifecycle
* `POST /api/reports`: Upload multipart file (PDF/PNG/JPEG); validates magic numbers and page constraints.
* `GET /api/reports`: List user reports with metadata and review status.
* `GET /api/reports/:id`: Get report metadata.
* `GET /api/reports/:id/file`: Stream original report binary securely with authenticated disposition.
* `DELETE /api/reports/:id`: Delete report file and corresponding database entries.
* `POST /api/reports/:id/extract`: Trigger background or direct OCR extraction via FastAPI.
* `GET /api/reports/:id/extraction`: Retrieve extracted rows.
* `PUT /api/reports/:id/extraction/rows`: Update, correct, or mark unreadable rows.
* `POST /api/reports/:id/extraction/review`: Mark rows as verified; increments `review_version`.

### 5. Report Interpretation & Q&A
* `POST /api/reports/:id/analysis`: Request AI interpretation of reviewed rows via FastAPI.
* `GET /api/reports/:id/analysis`: Retrieve existing cached interpretation for current review version.
* `POST /api/reports/:id/conversation`: Send contextual question regarding the report findings.
