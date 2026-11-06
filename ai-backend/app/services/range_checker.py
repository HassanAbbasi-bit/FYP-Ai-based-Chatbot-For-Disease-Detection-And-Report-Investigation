import re
from typing import Any, Optional, Tuple


def parse_range(
    reference_range: Optional[str],
    is_female: Optional[bool] = None
) -> Tuple[Optional[float], Optional[float]]:
    """
    Parse numerical and gender-specific laboratory reference ranges.

    Supported examples:
        13.5 - 17.5
        13.5 to 17.5
        < 200
        <= 200
        > 50
        >= 50
        M 40-54% F 36-47%
        Male: 13-17; Female: 12-15

    Returns:
        (lower_bound, upper_bound)

    None represents an unbounded side.
    """

    if not reference_range:
        return None, None

    cleaned = reference_range.strip()
    cleaned = cleaned.replace(",", "")
    cleaned = cleaned.replace("–", "-").replace("—", "-")

    cleaned = re.sub(
        r"\b[oO]\s*-\s*",
        "0 - ",
        cleaned
    )

    number = r"([+-]?\d+(?:\.\d+)?)"
    separator = r"\s*(?:-|to)\s*"

    def normalize_bounds(low: float, high: float):
        return (high, low) if low > high else (low, high)

    # Gender-specific reference ranges.
    gender_patterns = {
        True: [
            rf"\b(?:F|Female)\s*:?\s*{number}{separator}{number}",
            rf"\b(?:F|Female)\s*:?\s*<=?\s*{number}",
            rf"\b(?:F|Female)\s*:?\s*>=?\s*{number}",
        ],
        False: [
            rf"\b(?:M|Male)\s*:?\s*{number}{separator}{number}",
            rf"\b(?:M|Male)\s*:?\s*<=?\s*{number}",
            rf"\b(?:M|Male)\s*:?\s*>=?\s*{number}",
        ],
    }

    # Only treat as gender-specific if M/F/Male/Female is immediately followed by a range or bound
    has_gender_ranges = bool(
        re.search(
            r"\b(?:Male|Female|[MF])\s*[:\s]?\s*[0-9<>]",
            cleaned,
            re.IGNORECASE
        )
    )

    if is_female is not None and has_gender_ranges:
        for idx, pattern in enumerate(gender_patterns[is_female]):
            match = re.search(pattern, cleaned, re.IGNORECASE)

            if match:
                if idx == 0:
                    low = float(match.group(1))
                    high = float(match.group(2))
                    return normalize_bounds(low, high)
                elif idx == 1:
                    return None, float(match.group(1))
                elif idx == 2:
                    return float(match.group(1)), None

        # Do not accidentally use another gender's range.
        return None, None

    elif is_female is None and has_gender_ranges:
        # If gender is unknown, construct the physiological envelope [min(low), max(high)]
        m_male = re.search(
            rf"\b(?:M|Male)\s*:?\s*{number}{separator}{number}",
            cleaned,
            re.IGNORECASE
        )
        m_female = re.search(
            rf"\b(?:F|Female)\s*:?\s*{number}{separator}{number}",
            cleaned,
            re.IGNORECASE
        )
        if m_male and m_female:
            low = min(float(m_male.group(1)), float(m_female.group(1)))
            high = max(float(m_male.group(2)), float(m_female.group(2)))
            return normalize_bounds(low, high)
        elif m_female:
            return normalize_bounds(float(m_female.group(1)), float(m_female.group(2)))
        elif m_male:
            return normalize_bounds(float(m_male.group(1)), float(m_male.group(2)))

    # Ordinary numerical ranges.
    range_match = re.search(
        rf"{number}{separator}{number}",
        cleaned,
        re.IGNORECASE
    )

    if range_match:
        low = float(range_match.group(1))
        high = float(range_match.group(2))
        return normalize_bounds(low, high)

    # Less-than ranges.
    less_match = re.search(
        rf"<=?\s*{number}",
        cleaned
    )

    if less_match:
        return None, float(less_match.group(1))

    # Greater-than ranges.
    greater_match = re.search(
        rf">=?\s*{number}",
        cleaned
    )

    if greater_match:
        return float(greater_match.group(1)), None

    return None, None


def evaluate_lab_value(
    value: Any,
    reference_range: Optional[str],
    canonical_test_name: Optional[str] = None,
    is_female: Optional[bool] = None
) -> Tuple[str, bool, str, Any]:
    """
    Evaluate a numerical laboratory result against its reference range.

    Returns:
        (
            status,
            needs_review,
            clean_reference_range,
            final_value
        )

    Status:
        normal
        low
        high
        inconclusive

    Important:
        OCR decimal correction is heuristic, not a clinically
        validated correction. Any uncertain result should be
        checked against the original laboratory report.
    """

    original_value = value
    original_range = reference_range or "Not specified"

    try:
        val_str = str(value).strip().replace(",", "")

        # Do not interpret inequality-based results as exact values.
        if re.match(r"^\s*[<>]=?", val_str):
            return (
                "inconclusive",
                True,
                original_range,
                original_value
            )

        numeric_match = re.search(
            r"[-+]?\d*\.?\d+",
            val_str
        )

        if not numeric_match:
            return (
                "inconclusive",
                True,
                original_range,
                original_value
            )

        num_val = float(numeric_match.group(0))

        if not (float("-inf") < num_val < float("inf")):
            return (
                "inconclusive",
                True,
                original_range,
                original_value
            )

        # --------------------------------------------------
        # 1. OCR decimal correction for laboratory values
        # --------------------------------------------------

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
            if num_val < 100:
                num_val = round(num_val / 10.0, 2)
            else:
                num_val = round(num_val / 100.0, 2)

        elif canonical_test_name == "Potassium" and 20 <= num_val <= 80:
            num_val = round(num_val / 10.0, 2)

        # --------------------------------------------------
        # 2. Parse reference range
        # --------------------------------------------------

        low, high = parse_range(
            reference_range,
            is_female=is_female
        )

        # --------------------------------------------------
        # 3. OCR decimal correction for reference ranges
        # --------------------------------------------------

        if canonical_test_name == "Hemoglobin":

            if high is not None and high > 40:
                high = round(high / 10.0, 2)

            elif high is not None and 35 <= high <= 38:
                high = 17.0

            if low is not None and low > 40:
                low = round(low / 10.0, 2)

        elif canonical_test_name == "RDW-CV":

            if (
                low == 15
                and high is not None
                and high > 100
            ):
                low, high = 11.5, 14.5

            elif high is not None and high > 50:

                if low is not None and low > 50:
                    low = round(low / 10.0, 2)

                high = round(high / 10.0, 2)

        elif canonical_test_name == "MPV":

            if high is not None and high > 40:

                if low is not None and low > 40:
                    low = round(low / 10.0, 2)

                high = round(high / 10.0, 2)

        elif canonical_test_name == "Hematocrit (PCV)":

            if low == 0 and high is not None and high > 30:
                low = 36.0

            elif low == 0 and (high is None or high == 0):
                low, high = 36.0, 50.0

        elif canonical_test_name == "RBC Count":

            if high is not None and high > 20:
                divisor = 100.0 if high >= 100 else 10.0

                if low is not None:
                    low = round(low / divisor, 2)

                high = round(high / divisor, 2)

        elif canonical_test_name == "Total Leukocyte Count (WBC)":

            if high is not None and high <= 30 and num_val > 500:

                if low is not None:
                    low *= 1000

                high *= 1000

        elif canonical_test_name == "Platelet Count":

            if (
                (high is not None and high > 1000000)
                or (low is not None and low > 1000000)
            ):
                low, high = 150000.0, 450000.0

            elif high is not None and high < 1000 and num_val > 5000:

                if low is not None:
                    low *= 1000

                high *= 1000

        # --------------------------------------------------
        # 4. Construct standardized reference range
        # --------------------------------------------------

        clean_range = original_range

        if low is not None and high is not None:
            clean_range = f"{low:g} - {high:g}"

        elif high is not None:
            clean_range = f"< {high:g}"

        elif low is not None:
            clean_range = f"> {low:g}"

        # --------------------------------------------------
        # 5. Determine result status
        # --------------------------------------------------

        if low is not None and high is not None:

            if num_val < low:
                return "low", False, clean_range, num_val

            if num_val > high:
                return "high", False, clean_range, num_val

            return "normal", False, clean_range, num_val

        if high is not None:

            if num_val > high:
                return "high", False, clean_range, num_val

            return "normal", False, clean_range, num_val

        if low is not None:

            if num_val < low:
                return "low", False, clean_range, num_val

            return "normal", False, clean_range, num_val

        # No verified reference range.
        return (
            "inconclusive",
            True,
            original_range,
            num_val
        )

    except (ValueError, TypeError, OverflowError):
        return (
            "inconclusive",
            True,
            original_range,
            original_value
        )

    except Exception:
        return (
            "inconclusive",
            True,
            original_range,
            original_value
        )
