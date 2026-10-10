import re
from typing import Optional, Tuple

def parse_range(reference_range: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    """
    Parses a reference range string like '13.5 - 17.5' or '< 200' or '> 50'
    into (low_bound, high_bound).
    """
    if not reference_range:
        return None, None
        
    cleaned = reference_range.strip()
    
    # Matches "13.5 - 17.5" or "13.5-17.5" or "13.5 to 17.5"
    range_match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(?:-|to)\s*([0-9]+(?:\.[0-9]+)?)", cleaned)
    if range_match:
        try:
            return float(range_match.group(1)), float(range_match.group(2))
        except ValueError:
            pass

    # Matches "< 200" or "<= 200"
    less_match = re.search(r"<(=)?\s*([0-9]+(?:\.[0-9]+)?)", cleaned)
    if less_match:
        try:
            return None, float(less_match.group(2))
        except ValueError:
            pass

    # Matches "> 50" or ">= 50"
    greater_match = re.search(r">(?:=)?\s*([0-9]+(?:\.[0-9]+)?)", cleaned)
    if greater_match:
        try:
            return float(greater_match.group(1)), None
        except ValueError:
            pass

    return None, None

def evaluate_lab_value(value: str | float | int, reference_range: Optional[str]) -> Tuple[str, bool]:
    """
    Compares numerical lab result against reference range.
    Returns: (status: "normal" | "low" | "high" | "inconclusive", needs_review: bool)
    """
    try:
        # Extract numeric portion of the value
        val_str = str(value).strip().replace(",", "")
        numeric_match = re.search(r"[-+]?[0-9]*\.?[0-9]+", val_str)
        if not numeric_match:
            return "inconclusive", True
            
        num_val = float(numeric_match.group(0))
        low, high = parse_range(reference_range)
        
        if low is not None and high is not None:
            if num_val < low:
                return "low", False
            elif num_val > high:
                return "high", False
            else:
                return "normal", False
                
        elif high is not None:
            if num_val > high:
                return "high", False
            else:
                return "normal", False
                
        elif low is not None:
            if num_val < low:
                return "low", False
            else:
                return "normal", False
                
    except Exception:
        return "inconclusive", True

    return "normal", False
