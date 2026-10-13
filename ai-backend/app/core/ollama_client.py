import httpx
import logging
from typing import Dict, Any, List, Optional
from app.config import settings

class OllamaClient:
    def __init__(self, base_url: str = settings.OLLAMA_BASE_URL):
        self.base_url = base_url.rstrip("/")
        self.timeout = settings.MODEL_TIMEOUT_SECONDS
        self._client: Optional[httpx.AsyncClient] = None

    def get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=float(self.timeout),
                limits=httpx.Limits(max_keepalive_connections=20, max_connections=50)
            )
        return self._client

    async def check_health(self) -> Dict[str, Any]:
        """
        Pings Ollama service and lists installed models.
        """
        try:
            client = self.get_client()
            res = await client.get(f"{self.base_url}/api/tags", timeout=5.0)
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
        temperature: float = 0.2,
        max_tokens: Optional[int] = 450,
        json_mode: bool = False,
        response_schema: Optional[Dict[str, Any]] = None,
        context_tokens: Optional[int] = None
    ) -> str:
        """
        Calls Ollama generate endpoint with hardware-optimized inference options.
        """
        options: Dict[str, Any] = {
            "temperature": temperature,
            "num_ctx": context_tokens or settings.OLLAMA_NUM_CTX,
            "num_thread": settings.OLLAMA_NUM_THREAD,
            "use_mmap": True,
            "top_p": 0.9,
            "top_k": 40
        }
        if max_tokens:
            options["num_predict"] = max_tokens

        payload: Dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": settings.OLLAMA_KEEP_ALIVE,
            "options": options
        }
        if response_schema is not None:
            payload["format"] = response_schema
        elif json_mode:
            payload["format"] = "json"
        if system_prompt:
            payload["system"] = system_prompt

        try:
            client = self.get_client()
            res = await client.post(f"{self.base_url}/api/generate", json=payload)
            if res.status_code == 200:
                return res.json().get("response", "")
            else:
                logging.getLogger(__name__).warning("MODEL_REQUEST_REJECTED HTTP=%s", res.status_code)
                raise RuntimeError("The configured model request was rejected.")
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
        temperature: float = 0.2,
        max_tokens: Optional[int] = 350,
        context_tokens: Optional[int] = None
    ) -> str:
        """
        Calls Ollama chat endpoint with persistent memory and token limiting.
        """
        options: Dict[str, Any] = {
            "temperature": temperature,
            "num_ctx": context_tokens or settings.OLLAMA_NUM_CTX,
            "num_thread": settings.OLLAMA_NUM_THREAD,
            "use_mmap": True,
            "top_p": 0.9,
            "top_k": 40
        }
        if max_tokens:
            options["num_predict"] = max_tokens

        payload = {
            "model": model,
            "messages": messages,
            "stream": False,
            "keep_alive": settings.OLLAMA_KEEP_ALIVE,
            "options": options
        }
        try:
            client = self.get_client()
            res = await client.post(f"{self.base_url}/api/chat", json=payload)
            if res.status_code == 200:
                return res.json().get("message", {}).get("content", "")
            else:
                logging.getLogger(__name__).warning("MODEL_REQUEST_REJECTED HTTP=%s", res.status_code)
                raise RuntimeError("The configured model request was rejected.")
        except httpx.ConnectError:
            raise ConnectionError(
                f"Cannot connect to Ollama at {self.base_url}. Please ensure Ollama is installed and running."
            )
        except httpx.TimeoutException:
            raise TimeoutError(
                f"Ollama request timed out after {self.timeout}s."
            )

ollama_client = OllamaClient()
