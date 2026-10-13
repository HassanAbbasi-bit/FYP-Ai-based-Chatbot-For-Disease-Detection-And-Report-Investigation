from fastapi import APIRouter
from app.config import settings
from app.core.ollama_client import ollama_client
from app.models.schemas import HealthResponse
from pathlib import Path
import shutil

router = APIRouter(tags=["Health"])

@router.get("/health", response_model=HealthResponse)
async def get_health_status():
    """
    Checks health of FastAPI backend and Ollama local LLM connection.
    """
    ollama_health = await ollama_client.check_health()
    connected = ollama_health.get("connected", False)
    models = ollama_health.get("models", [])
    
    return HealthResponse(
        status="healthy",
        service=settings.PROJECT_NAME,
        version=settings.VERSION,
        ollama_connected=connected,
        active_model=settings.DEFAULT_MODEL,
        available_models=models,
        gpu_available=False,
        ocr_available=Path(settings.TESSERACT_CMD).is_file() or shutil.which("tesseract") is not None,
        details={
            "debug": settings.DEBUG,
            "ollama_base_url": settings.OLLAMA_BASE_URL,
            "models_count": len(models)
        }
    )
