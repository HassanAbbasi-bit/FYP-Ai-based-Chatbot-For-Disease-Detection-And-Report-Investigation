# Security, Privacy & Clinical Safety

This document outlines the security architecture, data privacy controls, and clinical safety guardrails implemented across the Medical Chatbot and Lab Report Investigation backend.

---

## 🔐 Authentication & Session Security

### 1. Password Protection (Argon2id)
All user passwords are encrypted using **Argon2id**, the industry-standard memory-hard password derivation function:
* Memory cost, time cost, and parallelism factors conform to OWASP recommendations.
* Passwords are never logged or stored in plaintext.
* Authentication comparisons use constant-time operations to neutralize timing-attack vulnerabilities.

### 2. MongoDB-Backed Session Store
User sessions are maintained server-side in MongoDB rather than in client-side JWTs:
* **HTTP-Only Cookies**: Prevents client-side script access to session identifiers (mitigating Cross-Site Scripting [XSS] token theft).
* **SameSite Strict/Lax**: Safeguards against Cross-Site Request Forgery (CSRF).
* **Deterministic Session Expiry**: Session cookies and MongoDB records expire together based on the initial sign-in time (`authExpiresAt`), preventing indefinite session extensions.
* **Instant Session Revocation**: Logging out instantly destroys the session record in MongoDB.

---

## 🛡️ Web Defense & Request Protection

### 1. CSRF & Origin Verification
* **Synchronized Token Defense**: State-altering operations (`POST`, `PUT`, `PATCH`, `DELETE`) require a synchronized CSRF token matching the user's active session.
* **Origin Checking**: The `checkOrigin` middleware verifies the `Origin` and `Referer` headers against configured allowed domains, blocking requests initiated by malicious third-party origins.

### 2. Header Hardening & Content Security
All API endpoints enforce secure HTTP response headers:
* `X-Content-Type-Options: nosniff` — Prevents MIME-type confusion attacks.
* `Cache-Control: no-store` — Ensures sensitive clinical data and reports are not cached by intermediate proxies or browser storage.
* `X-Frame-Options: DENY` — Prevents clickjacking attacks.

### 3. File Upload Defense
Medical report documents (PDF, PNG, JPEG) undergo rigorous inspection:
* **Streaming Validation**: Ingestion via Busboy with immediate byte-budget caps.
* **Magic Number Verification**: File headers and signatures are inspected to prevent spoofed file extensions.
* **Image Bounds**: Decoded via Sharp with dimensions capped at 8192px and single-frame checks to eliminate decompression bombs.
* **PDF Sandboxing**: Parsed using Cantoo PDF; active JavaScript, encrypted containers, and recursive streams are rejected.
* **Safe Storage**: Uploaded files are stored in private server storage with randomized UUID identifiers; raw file paths are never exposed to clients.

### 4. Rate Limiting & Resource Fencing
* **Authentication**: Limits consecutive failed login attempts to thwart credential stuffing and brute-force attacks.
* **Upload Quotas**: Enforces per-account file limits and concurrent validation locks.
* **Inference Leases**: Local LLM calls use timeouts and processing leases to prevent request pile-ups while accommodating cold-model load times.

---

## 🔒 Inter-Service Trust & Network Isolation

* **Isolated Engine**: The Python FastAPI service is accessible only to internal services.
* **Service Key (`X-Internal-Key`)**: All calls from Express to FastAPI must supply the shared private key. Direct browser requests to the AI engine are rejected.
* **Local Inference**: Generative models run on the local host via Ollama (`127.0.0.1:11434`). No patient questions, medical history, or lab results are ever transmitted to third-party public cloud AI APIs (e.g., OpenAI, Anthropic).

---

## ⚖️ Patient Privacy & Data Governance

### 1. Granular Consent Controls
The platform maintains distinct, auditable patient consent settings:
* `aiChatConsent`: Explicit opt-in permitting conversational AI processing of patient symptoms and questions.
* `reportAnalysisConsent`: Explicit opt-in permitting OCR extraction and automated clinical interpretation of uploaded medical reports.
* When consent is absent or revoked, the backend refuses to forward data to the AI model, returning an explicit permission notice.

### 2. GDPR/HIPAA-Aligned Account Erasure
A user may trigger complete account deletion via `DELETE /api/account`:
* All user records, demographic profiles, and consent histories are removed.
* Associated conversation threads and messages are purged.
* Stored report metadata, extracted tables, and AI analyses are deleted from MongoDB.
* Physical report binaries (PDFs/images) stored on disk are securely unlinked and scrubbed.

---

## 🩺 Clinical Safety Guardrails

### 1. Immediate Rule-Based Red-Flag Interceptors
Certain medical presentations require emergency intervention without AI latency:
* Real-time regex and keyword patterns intercept high-risk symptoms (e.g., acute chest pain, signs of stroke, severe respiratory distress, critical thrombocytopenia).
* Bypasses the LLM entirely to deliver immediate, deterministic emergency guidance (e.g., advising direct emergency room presentation or calling emergency services).

### 2. Grounded, Non-Fabricated Report Interpretation
AI interpretation of lab reports is strictly gated by the **Reviewed Data Contract**:
* Patients review and verify extracted lab test names, numerical values, and units before analysis.
* The AI prompt is bounded strictly to the verified data rows using JSON schema constraints and Pydantic validation.
* The model is prohibited from fabricating values, guessing unlisted lab tests, or making definitive diagnoses.
* Unreadable or missing values are explicitly flagged as inconclusive.

### 3. Clear Clinical Disclaimers
Every conversational response, symptom assessment, and lab report explanation includes a mandatory clinical disclaimer:
> *"This assessment is generated by an artificial intelligence assistant for educational and informational support. It does not constitute formal medical diagnosis, treatment, or professional advice. Always consult a qualified healthcare provider for clinical decisions."*
