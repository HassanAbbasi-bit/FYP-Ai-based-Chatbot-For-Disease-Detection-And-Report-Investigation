import httpx
from typing import Dict, Any, List, Optional
from app.config import settings

class OllamaClient:
    def __init__(self, base_url: str = settings.OLLAMA_BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.timeout = settings.MODEL_TIMEOUT_SECONDS

    async def check_health(self) -> Dict[str, Any]:
        """
        Pings Ollama service and lists installed models.
        """
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self.base_url}/api/tags")
                if res.status_code == 200:
                    data = res.json()
                    models = [m.get("name") for m in data.get("models", [])]
                    return {
                        "connected": True,
                        "models": models,
                        "base_url": self.base_url
                    }
        except Exception as e:
            return {
                "connected": False,
                "models": [],
                "error": str(e),
                "base_url": self.base_url
            }
        return {"connected": False, "models": []}

    async def generate_response(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        model: str = settings.DEFAULT_MODEL,
        temperature: float = 0.2
    ) -> str:
        """
        Calls Ollama generate endpoint with timeout and exception safety.
        """
        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }
        if system_prompt:
            payload["system"] = system_prompt

        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                res = await client.post(f"{self.base_url}/api/generate", json=payload)
                if res.status_code == 200:
                    return res.json().get("response", "")
                else:
                    return f"Error from Ollama (status {res.status_code}): {res.text}"
        except httpx.ConnectError:
            raise ConnectionError(
                f"Cannot connect to Ollama at {self.base_url}. Please ensure Ollama is installed and running."
            )
        except httpx.TimeoutException:
            raise TimeoutError(
                f"Ollama request timed out after {self.timeout}s. Model {model} is taking too long to respond."
            )

    async def chat_conversation(
        self,
        messages: List[Dict[str, str]],
        model: str = settings.DEFAULT_MODEL,
        temperature: float = 0.2
    ) -> str:
        """
        Calls Ollama chat endpoint with message history.
        """
        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature
            }
        }
        try:
            async with httpx.AsyncClient(timeout=float(self.timeout)) as client:
                res = await client.post(f"{self.base_url}/api/chat", json=payload)
                if res.status_code == 200:
                    return res.json().get("message", {}).get("content", "")
                else:
                    return f"Error from Ollama (status {res.status_code}): {res.text}"
        except httpx.ConnectError:
            raise ConnectionError(
                f"Cannot connect to Ollama at {self.base_url}. Please ensure Ollama is installed and running."
            )
        except httpx.TimeoutException:
            raise TimeoutError(
                f"Ollama request timed out after {self.timeout}s."
            )

ollama_client = OllamaClient()
