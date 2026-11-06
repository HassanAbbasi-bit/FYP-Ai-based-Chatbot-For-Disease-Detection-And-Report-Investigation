import re
from typing import Optional, Tuple, Any

def parse_range(reference_range: Optional[str]) -> Tuple[Optional[float], Optional[float]]:
    """
    Parses a reference range string like '13.5 - 17.5' or '< 200' or '> 50' or '4,000 - 11,000'
    into (low_bound, high_bound).
    """
    if not reference_range:
        return None, None
        
    cleaned = re.sub(r",", "", reference_range.strip())
    cleaned = re.sub(r"\b[oO]\s*-\s*", "0 - ", cleaned)
    
    # Matches "13.5 - 17.5" or "13.5-17.5" or "13.5 to 17.5"
    range_match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(?:-|to|–)\s*([0-9]+(?:\.[0-9]+)?)", cleaned)
    if range_match:
        try:
            low = float(range_match.group(1))
            high = float(range_match.group(2))
            if low > high:
                low, high = high, low
            return low, high
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

def evaluate_lab_value(
    value: Any, 
    reference_range: Optional[str], 
    canonical_test_name: Optional[str] = None
) -> Tuple[str, bool, str, Any]:
    """
    Compares numerical lab result against reference range with automated OCR decimal scaling
    and canonical reference bounds recovery.
    Returns: (status: "normal" | "low" | "high" | "inconclusive", needs_review: bool, clean_reference_range: str, final_value: Any)
    """
    try:
        val_str = str(value).strip().replace(",", "")
        if re.match(r"^\s*[<>]=?", val_str):
            return "inconclusive", True, reference_range or "Not specified", value

        numeric_match = re.search(r"[-+]?[0-9]*\.?[0-9]+", val_str)
        if not numeric_match:
            return "inconclusive", True, reference_range or "Not specified", value
            
        num_val = float(numeric_match.group(0))

        # 1. OCR Missing Decimal Auto-Repair for values
        if canonical_test_name == "Hemoglobin" and num_val > 40:
            num_val = round(num_val / 10.0, 2)
        elif canonical_test_name == "Hematocrit (PCV)" and num_val > 100:
            num_val = round(num_val / 10.0, 2)
        elif canonical_test_name == "MCV (Mean Corpuscular Volume)" and num_val > 300:
            num_val = round(num_val / 10.0, 2)
        elif canonical_test_name == "MCH" and num_val > 100:
            num_val = round(num_val / 10.0, 2)
        elif canonical_test_name == "MCHC" and num_val > 100:
            num_val = round(num_val / 10.0, 2)
        elif canonical_test_name == "RDW-CV" and num_val > 50:
            num_val = round(num_val / 10.0, 2)
        elif canonical_test_name == "MPV" and num_val > 40:
            num_val = round(num_val / 10.0, 2)
        elif canonical_test_name == "RBC Count" and num_val > 20:
            num_val = round(num_val / 10.0, 2) if num_val < 100 else round(num_val / 100.0, 2)

        low, high = parse_range(reference_range)
        
        # 2. OCR Missing Decimal Auto-Repair for reference ranges
        if canonical_test_name == "Hemoglobin":
            if high is not None and high > 40:
                high = round(high / 10.0, 2)
            elif high is not None and 35 <= high <= 38:  # Common OCR digit confusion 17.0 -> 37.0
                high = 17.0
            if low is not None and low > 40:
                low = round(low / 10.0, 2)
        elif canonical_test_name == "RDW-CV":
            if low is not None and (low == 15 or low == 15.0) and high is not None and high > 100:
                low, high = 11.5, 14.5
            elif high is not None and high > 50:
                if low is not None and low > 50:
                    low = round(low / 10.0, 2)
                high = round(high / 10.0, 2)
        elif canonical_test_name == "MPV" and high is not None and high > 40:
            if low is not None and low > 40:
                low = round(low / 10.0, 2)
            high = round(high / 10.0, 2)
        elif canonical_test_name == "Hematocrit (PCV)":
            if low is not None and low == 0 and high is not None and high > 30:
                low = 36.0
            elif (low is not None and low == 0) and (high is None or high == 0):
                low, high = 36.0, 50.0
        elif canonical_test_name == "Platelet Count":
            if (high is not None and high > 1000000) or (low is not None and low > 1000000):
                low, high = 150000.0, 450000.0

        # Construct clean, standardized range string
        clean_range = reference_range or "Not specified"
        if low is not None and high is not None:
            clean_range = f"{low:g} - {high:g}"
        elif high is not None:
            clean_range = f"< {high:g}"
        elif low is not None:
            clean_range = f"> {low:g}"

        # Determine status
        if low is not None and high is not None:
            if num_val < low:
                return "low", False, clean_range, num_val
            elif num_val > high:
                return "high", False, clean_range, num_val
            else:
                return "normal", False, clean_range, num_val
                
        elif high is not None:
            if num_val > high:
                return "high", False, clean_range, num_val
            else:
                return "normal", False, clean_range, num_val
                
        elif low is not None:
            if num_val < low:
                return "low", False, clean_range, num_val
            else:
                return "normal", False, clean_range, num_val
        else:
            return "inconclusive", True, reference_range or "Not specified", num_val
                
    except Exception:
        return "inconclusive", True, reference_range or "Not specified", value

    return "inconclusive", True, reference_range or "Not specified", value


