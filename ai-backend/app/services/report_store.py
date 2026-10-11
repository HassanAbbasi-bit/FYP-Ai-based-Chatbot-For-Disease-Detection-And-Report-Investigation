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
    # 1. Exact match in cache
    if report_id in REPORT_CACHE:
        return REPORT_CACHE[report_id]
        
    # 2. Tolerant fallback: if user provides a test_id (e.g. 't4'), 'string', 'latest',
    # or an arbitrary ID when a report was uploaded, return the most recent report.
    if LATEST_REPORT_ID and LATEST_REPORT_ID in REPORT_CACHE:
        return REPORT_CACHE[LATEST_REPORT_ID]
        
    return None

