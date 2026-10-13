import sys
from pathlib import Path

# Ensure ai-backend directory is in sys.path regardless of execution root
_ai_dir = str(Path(__file__).resolve().parent.parent)
if _ai_dir not in sys.path:
    sys.path.insert(0, _ai_dir)

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"

def test_health_endpoint():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "ollama_connected" in data

def test_chat_endpoint_normal():
    response = client.post(
        "/api/chat",
        headers={"X-Internal-Key": "synthetic-internal-test-key"},
        json={
            "conversation_id": "test_conv",
            "message": "I have had a mild headache since yesterday.",
            "history": []
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert "reply" in data
    assert data["urgency_level"] in ["low", "moderate"]

def test_chat_endpoint_red_flag():
    response = client.post(
        "/api/chat",
        headers={"X-Internal-Key": "synthetic-internal-test-key"},
        json={
            "conversation_id": "test_conv",
            "message": "I have crushing chest pain radiating to my left arm.",
            "history": []
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert data["urgency_level"] == "emergency"
    assert "CRITICAL" in data["reply"]

def test_symptom_assessment(monkeypatch):
    import json
    from app.core.ollama_client import ollama_client
    async def health(): return {"connected": True}
    async def generate(**kwargs): return json.dumps({"possible_causes": [{"condition": "Synthetic possibility", "likelihood": "possible", "rationale": "Fixture only"}], "recommended_questions_for_doctor": ["Synthetic question"], "self_care_notes": "Fixture only"})
    monkeypatch.setattr(ollama_client, "check_health", health)
    monkeypatch.setattr(ollama_client, "generate_response", generate)
    response = client.post(
        "/api/symptoms/assess",
        headers={"X-Internal-Key": "synthetic-internal-test-key"},
        json={
            "symptoms": ["headache", "fatigue"],
            "duration": "2 days"
        }
    )
    assert response.status_code == 200
    data = response.json()
    assert len(data["possible_causes"]) > 0

def test_sample_contract_endpoint():
    response = client.get("/api/sample/contract")
    assert response.status_code == 200
    data = response.json()
    assert "endpoints" in data
