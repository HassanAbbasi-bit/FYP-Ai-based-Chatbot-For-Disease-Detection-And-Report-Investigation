import json
from pathlib import Path
from typing import Dict, Any, Optional
from app.config import settings

CACHE_FILE = settings.UPLOAD_DIR / "report_cache.json"

REPORT_CACHE: Dict[str, Dict[str, Any]] = {}
LATEST_REPORT_ID: Optional[str] = None

def _load_disk_cache():
    global REPORT_CACHE, LATEST_REPORT_ID
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                REPORT_CACHE.update(saved.get("reports", {}))
                if saved.get("latest_id"):
                    LATEST_REPORT_ID = saved.get("latest_id")
        except Exception:
            pass

_load_disk_cache()

def save_report(report_id: str, data: Dict[str, Any]) -> None:
    global LATEST_REPORT_ID
    REPORT_CACHE[report_id] = data
    LATEST_REPORT_ID = report_id
    try:
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump({"latest_id": LATEST_REPORT_ID, "reports": REPORT_CACHE}, f)
    except Exception:
        pass

def get_report(report_id: str) -> Optional[Dict[str, Any]]:
    # 1. Exact match in cache
    if report_id in REPORT_CACHE:
        return REPORT_CACHE[report_id]
        
    # 2. Tolerant fallback: if user provides a test_id (e.g. 't4', 't14'), 'string', 'latest'
    if LATEST_REPORT_ID and LATEST_REPORT_ID in REPORT_CACHE:
        return REPORT_CACHE[LATEST_REPORT_ID]
        
    # 3. Reload from disk in case of reload
    _load_disk_cache()
    if report_id in REPORT_CACHE:
        return REPORT_CACHE[report_id]
    if LATEST_REPORT_ID and LATEST_REPORT_ID in REPORT_CACHE:
        return REPORT_CACHE[LATEST_REPORT_ID]
        
    return None

EXPLANATION_CACHE: Dict[str, Dict[str, Any]] = {}

def save_explanation(key: str, data: Dict[str, Any]) -> None:
    EXPLANATION_CACHE[key] = data

def get_explanation(key: str) -> Optional[Dict[str, Any]]:
    return EXPLANATION_CACHE.get(key)


