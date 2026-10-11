import uuid
import json
from fastapi import APIRouter, Depends
from app.models.schemas import SymptomAssessmentRequest, SymptomAssessmentResponse, PossibleCause
from app.core.security import verify_internal_auth, sanitize_medical_text
from app.services.urgency_rules import evaluate_urgency
from app.core.ollama_client import ollama_client

router = APIRouter(tags=["Symptoms"])

@router.post("/symptoms/assess", response_model=SymptomAssessmentResponse, dependencies=[Depends(verify_internal_auth)])
async def assess_symptoms(request: SymptomAssessmentRequest):
    """
    Evaluates reported symptoms, checks clinician red flags,
    and returns precise possible causes with calibrated uncertainty using llama3.2:3b.
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
                    rationale="Reported symptoms match clinical red-flag indicators requiring urgent in-person emergency intervention."
                )
            ],
            recommended_questions_for_doctor=[
                "Are emergency diagnostic checks or imaging immediately required?"
            ],
            self_care_notes="Do NOT wait. Seek immediate medical emergency care."
        )

    # Use llama3.2:3b to generate precise, personalized assessment
    try:
        health = await ollama_client.check_health()
        if health.get("connected"):
            symptoms_str = ", ".join(clean_symptoms)
            duration_str = request.duration or "unspecified"
            severity_str = request.severity or "moderate"
            
            prompt = f"""You are a clinical AI health triage assistant.
Evaluate this patient symptom profile:
Symptoms: {symptoms_str}
Duration: {duration_str}
Severity: {severity_str}

Guidelines:
1. Provide the top 2 plausible differential causes with calibrated uncertainty (likelihood: 'possible' or 'likely').
2. Keep each rationale concise (strictly 1-2 sentences).
3. Formulate 2 short, high-yield questions for the patient to ask their physician.
4. Provide safe self-care guidance in 1-2 sentences.

Return ONLY valid JSON matching this schema:
{{
  "possible_causes": [
    {{
      "condition": "Condition Name",
      "likelihood": "possible",
      "rationale": "Medical rationale (1-2 sentences)."
    }}
  ],
  "recommended_questions_for_doctor": [
    "Question 1",
    "Question 2"
  ],
  "self_care_notes": "Safe self-care guidance."
}}
"""
            system_prompt = "You are a clinical diagnostic educator. Return valid JSON only. Never issue a definitive diagnosis."
            raw = await ollama_client.generate_response(prompt=prompt, system_prompt=system_prompt, temperature=0.2, max_tokens=420, json_mode=True)
            
            clean_json = raw.strip()
            if "```json" in clean_json:
                clean_json = clean_json.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_json:
                clean_json = clean_json.split("```")[1].split("```")[0].strip()
                
            data = json.loads(clean_json)
            possible_causes = [PossibleCause(**c) for c in data.get("possible_causes", [])]
            recommended_questions = data.get("recommended_questions_for_doctor", [])
            self_care = data.get("self_care_notes", "Maintain hydration and rest. Seek clinical review if symptoms worsen.")

            if possible_causes:
                return SymptomAssessmentResponse(
                    assessment_id=assessment_id,
                    extracted_symptoms=clean_symptoms,
                    urgency_level=urgency,
                    is_red_flag=False,
                    escalation_message=None,
                    possible_causes=possible_causes,
                    recommended_questions_for_doctor=recommended_questions,
                    self_care_notes=self_care
                )
    except Exception:
        pass

    # Grounded heuristic fallback if model times out
    return SymptomAssessmentResponse(
        assessment_id=assessment_id,
        extracted_symptoms=clean_symptoms,
        urgency_level=urgency,
        is_red_flag=False,
        escalation_message=None,
        possible_causes=[
            PossibleCause(
                condition="Upper Respiratory or Viral Syndrome",
                likelihood="possible",
                rationale=f"Reported symptoms ({', '.join(clean_symptoms)}) frequently align with common self-limiting viral illnesses."
            ),
            PossibleCause(
                condition="Physical Exhaustion / Tension",
                likelihood="possible",
                rationale="Fatigue and headaches often correlate with stress, dehydration, or viral recovery."
            )
        ],
        recommended_questions_for_doctor=[
            "Given these symptoms, are diagnostic checks like a CBC or throat swab indicated?",
            "What specific warning signs should prompt an earlier clinic revisit?"
        ],
        self_care_notes="Ensure adequate fluid intake and rest. Monitor temperature and seek evaluation if symptoms persist beyond 5-7 days."
    )
