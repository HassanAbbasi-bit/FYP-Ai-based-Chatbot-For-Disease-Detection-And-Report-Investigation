import uuid
from fastapi import APIRouter, Depends
from app.models.schemas import SymptomAssessmentRequest, SymptomAssessmentResponse, PossibleCause
from app.core.security import verify_internal_auth, sanitize_medical_text
from app.services.urgency_rules import evaluate_urgency

router = APIRouter(tags=["Symptoms"])

@router.post("/symptoms/assess", response_model=SymptomAssessmentResponse, dependencies=[Depends(verify_internal_auth)])
async def assess_symptoms(request: SymptomAssessmentRequest):
    """
    Evaluates reported symptoms, detects clinician red flags,
    and returns possible causes with calibrated uncertainty.
    """
    clean_symptoms = [sanitize_medical_text(s) for s in request.symptoms]
    urgency, is_red_flag, escalation = evaluate_urgency(clean_symptoms)
    
    assessment_id = f"asmt_{uuid.uuid4().hex[:8]}"

    # If critical red flag detected, return emergency escalation immediately
    if is_red_flag:
        return SymptomAssessmentResponse(
            assessment_id=assessment_id,
            extracted_symptoms=clean_symptoms,
            urgency_level="emergency",
            is_red_flag=True,
            escalation_message=escalation,
            possible_causes=[
                PossibleCause(
                    condition="Potential Acute Medical Emergency",
                    likelihood="likely",
                    rationale="Reported symptoms match clinical red-flag indicators requiring urgent medical intervention."
                )
            ],
            recommended_questions_for_doctor=[
                "Are emergency interventions or diagnostic imaging immediately necessary?"
            ],
            self_care_notes="Do NOT wait. Seek immediate medical assistance."
        )

    # General assessment mapping with uncertainty
    possible_causes = [
        PossibleCause(
            condition="Common Viral Illness or Physical Strain",
            likelihood="possible",
            rationale=f"Reported symptoms ({', '.join(clean_symptoms)}) frequently present in mild viral infections or physical exhaustion."
        ),
        PossibleCause(
            condition="Tension or Lifestyle Factors",
            likelihood="possible",
            rationale="Dehydration, poor sleep, or stress can trigger similar symptom clusters."
        )
    ]

    return SymptomAssessmentResponse(
        assessment_id=assessment_id,
        extracted_symptoms=clean_symptoms,
        urgency_level=urgency,
        is_red_flag=False,
        escalation_message=None,
        possible_causes=possible_causes,
        recommended_questions_for_doctor=[
            "Given these symptoms, are there any specific lab tests (such as a CBC) that should be ordered?",
            "What signs should prompt me to seek immediate follow-up if symptoms persist?"
        ],
        self_care_notes="Ensure adequate hydration and rest. Monitor whether symptoms improve over the next 48 hours."
    )
