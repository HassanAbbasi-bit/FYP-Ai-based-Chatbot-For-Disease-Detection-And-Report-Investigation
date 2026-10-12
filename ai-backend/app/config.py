import os
from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parent.parent / '.env', extra="ignore")

    PROJECT_NAME: str = "Medical AI Backend"
    VERSION: str = "1.0.0"
    DEBUG: bool = False
    
    # Internal Communication Security (Between Express and FastAPI)
    INTERNAL_API_KEY: str = ""
    
    # Ollama Configuration & Performance Tuning
    OLLAMA_BASE_URL: str = "http://localhost:11434"
    DEFAULT_MODEL: str = "llama3.2:3b"
    EMBEDDING_MODEL: str = "nomic-embed-text"
    MODEL_TIMEOUT_SECONDS: int = 480
    OLLAMA_KEEP_ALIVE: str = "5m"
    OLLAMA_NUM_CTX: int = 4096
    OLLAMA_NUM_THREAD: int = 4

    
    # File Upload & Processing
    BASE_DIR: Path = Path(__file__).resolve().parent.parent
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    REFERENCE_DIR: Path = BASE_DIR / "app" / "references"
    CHROMA_PERSIST_DIR: Path = BASE_DIR / "chroma_db"
    
    # OCR Tesseract executable path on Windows
    TESSERACT_CMD: str = r"C:\Program Files\Tesseract-OCR\tesseract.exe" if Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe").is_file() else os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe")
    
    # Allowed CORS Origins (Friend 2 React & Express apps)
    ALLOWED_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:5000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5000"
    ]

settings = Settings()

# Ensure required directories exist
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.REFERENCE_DIR.mkdir(parents=True, exist_ok=True)
settings.CHROMA_PERSIST_DIR.mkdir(parents=True, exist_ok=True)
