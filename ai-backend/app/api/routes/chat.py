from fastapi import APIRouter, Depends
from app.models.schemas import ChatRequest, ChatResponse
from app.core.security import verify_internal_auth, sanitize_medical_text
from app.core.ollama_client import ollama_client
from app.services.urgency_rules import evaluate_urgency

router = APIRouter(tags=["Chat"])

MEDICAL_SYSTEM_PROMPT = """
You are an empathetic, clinical AI health assistant designed to help patients understand symptoms and lab results.
Guidelines:
1. Always maintain a calm, supportive, professional tone.
2. Explain medical terms in plain, easy-to-understand language.
3. Express calibrated uncertainty (e.g., 'This could possibly indicate...', 'Common factors include...').
4. Never issue a definitive clinical diagnosis or prescribe medications.
5. Offer 2-3 relevant follow-up questions to help the patient clarify their symptoms.
6. Always advise consulting a licensed physician.
"""

@router.post("/chat", response_model=ChatResponse, dependencies=[Depends(verify_internal_auth)])
async def process_chat_message(request: ChatRequest):
    """
    Receives user message and conversation history, evaluates urgency,
    and returns a structured grounded response.
    """
    clean_message = sanitize_medical_text(request.message)
    
    # 1. Check for immediate emergency red flags
    urgency, is_red_flag, escalation = evaluate_urgency(clean_message)
    if is_red_flag:
        return ChatResponse(
            reply=escalation,
            suggested_follow_ups=["Have you called emergency services?", "Are you with someone who can assist you?"],
            urgency_level="emergency",
            disclaimer="CRITICAL EMERGENCY: Seek in-person emergency care immediately."
        )

    # 2. Check if Ollama is connected
    health = await ollama_client.check_health()
    if health.get("connected"):
        messages = [{"role": "system", "content": MEDICAL_SYSTEM_PROMPT}]
        for hist in request.history[-6:]:
            messages.append({"role": hist.role, "content": sanitize_medical_text(hist.content)})
        messages.append({"role": "user", "content": clean_message})

        try:
            llm_reply = await ollama_client.chat_conversation(messages)
            return ChatResponse(
                reply=llm_reply,
                suggested_follow_ups=[
                    "When did this first begin?",
                    "Have you taken any medication or experienced related symptoms?",
                    "Does anything make it better or worse?"
                ],
                urgency_level=urgency
            )
        except Exception:
            # Fallback if model call fails
            pass

    # 3. Fallback structured response for development & testing
    return ChatResponse(
        reply=f"Thank you for sharing your concerns regarding '{clean_message}'. While everyday factors like tiredness or strain may play a role, paying attention to how symptoms evolve is important. Could you share how long you have felt this way?",
        suggested_follow_ups=[
            "How long have you had these symptoms?",
            "Do you have a fever or severe discomfort?",
            "Are you currently taking any prescription medications?"
        ],
        urgency_level=urgency,
        disclaimer="Development Mode: Live Ollama model will process your prompt once started."
    )
