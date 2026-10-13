import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pytest
from app.config import settings
from app.core.ollama_client import ollama_client
@pytest.fixture(autouse=True)
def isolated_provider(monkeypatch):
    monkeypatch.setattr(settings, 'INTERNAL_API_KEY', 'synthetic-internal-test-key')
    async def offline(): return {'connected': False, 'models': []}
    monkeypatch.setattr(ollama_client, 'check_health', offline)
