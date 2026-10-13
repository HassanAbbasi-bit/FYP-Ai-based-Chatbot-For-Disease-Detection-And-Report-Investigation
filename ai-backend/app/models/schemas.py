from typing import List, Optional, Any, Dict
from pydantic import BaseModel, Field

# -------------------------------------------------------------
# Health Check Schemas
# -------------------------------------------------------------
class HealthResponse(BaseModel):
    status: str = "healthy"
    service: str = "Medical AI Backend"
    version: str = "1.0.0"
    ollama_connected: bool = False
    active_model: str = "llama3.2:3b"
    available_models: List[str] = Field(default_factory=list)
    gpu_available: bool = False
    ocr_available: bool = False
    details: Optional[Dict[str, Any]] = None

# -------------------------------------------------------------
# Chat Schemas (Task 3)
# -------------------------------------------------------------
class ChatHistoryMessage(BaseModel):
    role: str  # "user", "assistant", "system"
    content: str

class ChatRequest(BaseModel):
    conversation_id: Optional[str] = "conv_default"
    message: str
    history: List[ChatHistoryMessage] = Field(default_factory=list)
    patient_context: Optional[Dict[str, Any]] = None

class ChatResponse(BaseModel):
    reply: str
    suggested_follow_ups: List[str] = Field(default_factory=list)
    urgency_level: str = "low"  # "low", "moderate", "high", "emergency"
    disclaimer: str = "This information is educational and not a substitute for professional medical advice."

# -------------------------------------------------------------
# Symptom Assessment Schemas (Task 4 & 5)
# -------------------------------------------------------------
class SymptomAssessmentRequest(BaseModel):
    user_id: Optional[str] = None
    symptoms: List[str]
    duration: Optional[str] = "unknown"
    severity: Optional[str] = None
    additional_notes: Optional[str] = None

class PossibleCause(BaseModel):
    condition: str
    likelihood: str  # "possible", "likely", "unlikely"
    rationale: str

class SymptomAssessmentResponse(BaseModel):
    origin: str = "rules"
    assessment_id: str
    extracted_symptoms: List[str]
    urgency_level: str  # "low", "moderate", "high", "emergency"
    is_red_flag: bool = False
    escalation_message: Optional[str] = None
    possible_causes: List[PossibleCause] = Field(default_factory=list)
    recommended_questions_for_doctor: List[str] = Field(default_factory=list)
    self_care_notes: Optional[str] = None

# -------------------------------------------------------------
# Medical Report Extraction Schemas (Task 6, 7, 8, 9)
# -------------------------------------------------------------
class LabTestItem(BaseModel):
    test_id: str
    name: str
    value: Any
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    status: str = "normal"  # "normal", "high", "low", "abnormal", "inconclusive"
    page: int = 1
    needs_review: bool = False
    review_reason: Optional[str] = None

class ValidationFlag(BaseModel):
    test_name: str
    issue: str  # "unreadable_value", "missing_unit", "conflicting_value", "borderline"
    message: str

class ReportExtractionResponse(BaseModel):
    report_id: str
    report_date: Optional[str] = None
    patient_name_redacted: bool = True
    tests: List[LabTestItem] = Field(default_factory=list)
    validation_flags: List[ValidationFlag] = Field(default_factory=list)
    critical_alerts: List[str] = Field(default_factory=list)
    raw_text_length: int = 0

# -------------------------------------------------------------
# Medical Explanation & Retrieval Schemas (Task 10, 11, 12)
# -------------------------------------------------------------
class CitationItem(BaseModel):
    source: str
    passage: str

class FindingItem(BaseModel):
    test_name: str
    finding: str
    plain_language_explanation: str
    citations: List[CitationItem] = Field(default_factory=list)

class ReportExplanationResponse(BaseModel):
    report_id: str
    summary: str
    findings: List[FindingItem] = Field(default_factory=list)
    doctor_discussion_questions: List[str] = Field(default_factory=list)
    disclaimer: str = "AI interpretations are for educational preparation only. Consult your physician for clinical diagnosis and treatment plans."

# -------------------------------------------------------------
# Doctor Visit Summary Schemas (Task 14)
# -------------------------------------------------------------
class DoctorVisitSummaryResponse(BaseModel):
    patient_summary: str
    symptoms_recap: List[str]
    lab_highlights: List[Dict[str, Any]]
    suggested_physician_questions: List[str]
