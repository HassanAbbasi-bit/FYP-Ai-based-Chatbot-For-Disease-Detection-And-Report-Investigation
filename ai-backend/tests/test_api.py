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
        headers={"X-Internal-Key": "dev"},
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
        headers={"X-Internal-Key": "dev"},
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

def test_symptom_assessment():
    response = client.post(
        "/api/symptoms/assess",
        headers={"X-Internal-Key": "dev"},
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
