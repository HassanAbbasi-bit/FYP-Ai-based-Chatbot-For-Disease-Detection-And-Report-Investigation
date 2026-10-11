from typing import Dict, Any, Optional

# In-memory store for recently processed reports
# Maps report_id -> report dictionary
REPORT_CACHE: Dict[str, Dict[str, Any]] = {}

# Keep track of the latest report processed
LATEST_REPORT_ID: Optional[str] = None

def save_report(report_id: str, data: Dict[str, Any]) -> None:
    global LATEST_REPORT_ID
    REPORT_CACHE[report_id] = data
    LATEST_REPORT_ID = report_id

def get_report(report_id: str) -> Optional[Dict[str, Any]]:
    # If the user asks for "string" or "latest" from Swagger UI, fallback to latest
    if report_id in ["string", "latest", "default"] and LATEST_REPORT_ID:
        return REPORT_CACHE.get(LATEST_REPORT_ID)
    return REPORT_CACHE.get(report_id)
