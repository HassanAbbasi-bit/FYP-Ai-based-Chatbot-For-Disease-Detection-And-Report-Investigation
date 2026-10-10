import json
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.api.routes import health, chat, symptoms, reports

app = FastAPI(
    title=settings.PROJECT_NAME,
    version=settings.VERSION,
    description="Medical AI Backend Service for Friend 1 & Friend 2 Pair Integration"
)

# Enable CORS for Friend 2's React and Express services
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API Routers
app.include_router(health.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(symptoms.router, prefix="/api")
app.include_router(reports.router, prefix="/api")

@app.get("/")
async def root():
    return {
        "service": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "online",
        "docs_url": "/docs",
        "contract_url": "/api/sample/contract"
    }

@app.get("/api/sample/contract")
async def get_agreed_contract():
    """
    Returns the agreed sample JSON contract so Friend 2 can easily mock
    and connect their Express & React interfaces immediately.
    """
    contract_file = settings.BASE_DIR / "sample_api_responses.json"
    if contract_file.exists():
        with open(contract_file, "r") as f:
            return JSONResponse(content=json.load(f))
    return {"message": "Sample responses contract not found"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
