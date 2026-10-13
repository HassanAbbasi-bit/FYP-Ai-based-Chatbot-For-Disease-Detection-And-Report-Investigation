import re
from typing import List, Tuple, Optional

# Emergency escalation heuristics; not a clinically validated diagnosis.
RED_FLAG_PATTERNS = [
    (r"\b(crushing\s+chest\s+pain|severe\s+chest\s+pain|chest\s+pressure|radiating\s+to\s+(left\s+)?arm|radiating\s+to\s+jaw)\b", "Severe cardiovascular distress / potential myocardial infarction"),
    (r"\b(face\s+droop(ing)?|slurred\s+speech|one[\s-]sided\s+weakness|sudden\s+numbness|loss\s+of\s+speech)\b", "Signs of acute stroke (FAST protocol)"),
    (r"\b(thunderclap\s+headache|worst\s+headache\s+of\s+my\s+life|sudden\s+severe\s+headache)\b", "Potential intracranial hemorrhage or acute neurological event"),
    (r"\b(stiff\s+neck\s+with\s+fever|confusion\s+with\s+fever|inability\s+to\s+bend\s+neck)\b", "Signs of potential acute meningitis"),
    (r"\b(can'?t\s+breathe|severe\s+shortness\s+of\s+breath|gasping|lips\s+turning\s+blue)\b", "Severe acute respiratory distress / hypoxia"),
    (r"\b(throat\s+swelling|anaphylaxis|swollen\s+tongue\s+and\s+breathing)\b", "Severe acute anaphylactic reaction"),
    (r"\b(coughing\s+up\s+blood|vomiting\s+blood|black\s+tarry\s+stools)\b", "Acute internal or gastrointestinal bleeding"),
    (r"\b(suicid(al|e)|want\s+to\s+die|harm\s+myself)\b", "Acute mental health crisis / suicidal ideation")
]

EMERGENCY_ESCALATION_MESSAGE = (
    "CRITICAL NOTICE: The symptoms you described indicate a potential medical emergency. "
    "Please call your local emergency services (e.g., 911, 999, or 112) or immediately go to the nearest emergency room. "
    "Do not wait for further online consultation."
)

def evaluate_urgency(text_or_symptoms: List[str] | str) -> Tuple[str, bool, Optional[str]]:
    """
    Evaluates symptoms against clinician-reviewed red-flag rules.
    Returns: (urgency_level, is_red_flag, escalation_message)
    """
    combined_text = " ".join(text_or_symptoms) if isinstance(text_or_symptoms, list) else text_or_symptoms
    
    for pattern, rationale in RED_FLAG_PATTERNS:
        if re.search(pattern, combined_text, re.IGNORECASE):
            return "emergency", True, f"{EMERGENCY_ESCALATION_MESSAGE} (Flagged: {rationale})"
            
    # Moderate indicators
    moderate_keywords = ["fever", "vomiting", "dizziness", "migraine", "pain", "swelling", "infection"]
    if any(re.search(rf"\b{kw}\b", combined_text, re.IGNORECASE) for kw in moderate_keywords):
        return "moderate", False, None

    return "low", False, None
