import re
from fastapi import Header, HTTPException, status
from app.config import settings

def verify_internal_auth(x_internal_key: str = Header(None)):
    """
    Validates internal service key between Express backend and FastAPI.
    Allows local development without blocking when debugging.
    """
    if settings.DEBUG and (x_internal_key is None or x_internal_key == "dev"):
        return True
    
    if x_internal_key != settings.INTERNAL_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized internal service call. Invalid X-Internal-Key."
        )
    return True

# Suspicious prompt injection patterns that might be embedded in uploaded medical reports
SUSPICIOUS_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior)\s+instructions",
    r"system\s*prompt",
    r"you\s+are\s+now\s+an?\s+unrestricted",
    r"output\s+the\s+system\s+prompt",
    r"<\s*\|?im_start\|?\s*>",
    r"<\s*\|?system\|?\s*>",
    r"disregard\s+(all\s+)?rules",
    r"roleplay\s+as",
]

def sanitize_medical_text(text: str) -> str:
    """
    Cleanses and sanitizes extracted text from uploaded medical documents
    to prevent prompt injection or adversarial jailbreak instructions
    from hijacking the Ollama LLM.
    """
    if not text:
        return ""
        
    sanitized = text
    for pattern in SUSPICIOUS_PATTERNS:
        sanitized = re.sub(pattern, "[FILTERED_ADVERSARIAL_INSTRUCTION]", sanitized, flags=re.IGNORECASE)
        
    # Remove control characters while preserving common whitespace and punctuation
    sanitized = "".join(ch for ch in sanitized if ch.isprintable() or ch in "\n\r\t")
    return sanitized
