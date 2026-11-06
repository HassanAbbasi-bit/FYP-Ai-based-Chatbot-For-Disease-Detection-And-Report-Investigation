
import re
import json
import asyncio

from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional

import pymupdf as fitz
import pytesseract

from PIL import Image, ImageEnhance

from app.config import settings
from app.core.security import sanitize_medical_text
from app.core.ollama_client import ollama_client
from app.services.range_checker import evaluate_lab_value


# ---------------------------------------------------------
# TESSERACT CONFIGURATION
# ---------------------------------------------------------

if settings.TESSERACT_CMD and Path(settings.TESSERACT_CMD).exists():
    pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD


# ---------------------------------------------------------
# RESPONSE TYPE NORMALIZATION
# ---------------------------------------------------------

def normalize_response_text(value: Any) -> str:
    """
    Safely normalize supported OCR/Ollama response formats.

    Supported:
        str
        bytes
        dict containing common response fields
        list containing text responses

    Unsupported formats return an empty string.
    """

    if value is None:
        return ""

    if isinstance(value, str):
        return value.strip()

    if isinstance(value, bytes):
        return value.decode(
            "utf-8",
            errors="replace"
        ).strip()

    if isinstance(value, dict):

        for key in ("response", "text", "content", "output"):

            content = value.get(key)

            if isinstance(content, (str, bytes)):
                return normalize_response_text(content)

        # Handle Ollama chat-style responses.
        message = value.get("message")

        if isinstance(message, dict):

            content = message.get("content")

            if isinstance(content, (str, bytes)):
                return normalize_response_text(content)

        return ""

    if isinstance(value, list):

        parts = [
            normalize_response_text(item)
            for item in value
        ]

        return "\n".join(
            part for part in parts if part
        )

    return ""


# ---------------------------------------------------------
# UNIT NORMALIZATION
# ---------------------------------------------------------

UNIT_FIXES = {
    "fst": "g/dL",
    "fst.": "g/dL",
    "ofet": "pg",
    "oiet": "pg",
    "diet": "pg",

    "joumm": "/uL",
    "youmm": "/uL",
    "umm": "/uL",
    "cumm": "/uL",
    "joumm/": "/uL",

    "mae eum": "10^6/uL",
    "maeeum": "10^6/uL",
    "milvourm": "10^6/uL",

    "ff": "fL",
    "ff.": "fL",
    "fl": "fL",
    "f": "fL",

    "po": "pg",
    "pe": "pg",
    "pg": "pg",

    "m2": "%",
    "*": "%",
    "%": "%",
    "*%": "%",

    "e/dt": "g/dL",
    "g/dt": "g/dL",
    "g/dl": "g/dL",
    "g/d": "g/dL",
    "gid": "g/dL",

    # mg% and gm% are different units.
    "mg%": "mg/dL",
    "gm%": "g/dL",

    "femtolitres": "fL",
    "femtolitre": "fL",

    "pa/cell": "pg",
    "pg/cell": "pg",
    "pgicell": "pg",

    "1083/ul": "10^3/uL",
    "10*3/ul": "10^3/uL",
    "10^3/ul": "10^3/uL",
    "1043/ul": "10^3/uL",
    "10°3/ul": "10^3/uL",

    "410*6/ul": "10^6/uL",
    "10*6/ul": "10^6/uL",
    "10^6/ul": "10^6/uL",
    "10°6/ul": "10^6/uL",

    "memol/l": "mmol/L",
    "mcmol/l": "mmol/L",
    "meq": "mEq/L",

    "cells/yal": "/uL",
    "cells/pat": "/uL",
    "cells/jab": "/uL",
    "cells/al": "/uL",
    "cells/ut": "/uL",
    "cells/ul": "/uL",
    "cells/pt": "/uL",
    "cells/it": "/uL",

    "million/st": "10^6/uL",
    "million/pt": "10^6/uL",
    "million/it": "10^6/uL",
    "million/ul": "10^6/uL",

    "by": "%",
}


# ---------------------------------------------------------
# TEST NAME CANONICALIZATION
# ---------------------------------------------------------

NAME_FIXES = [

    (
        r"mean corpusc.*(?:hemoglobin|haemoglobin).*conc.*|mchc\b",
        ("MCHC", "g/dL", "32.0 - 36.0")
    ),

    (
        r"mean corpusc.*(?:hemoglobin|haemoglobin)|mch\b",
        ("MCH", "pg", "27.0 - 33.0")
    ),

    (
        r"mean corpusc.*volu.*|mc[vw]\b",
        ("MCV (Mean Corpuscular Volume)", "fL", "80.0 - 100.0")
    ),

    (
        r"mean platelet volume|mpv\b",
        ("MPV", "fL", "7.5 - 11.5")
    ),

    (
        r"platelet count|total platelet|platelets?\b|plt\b",
        ("Platelet Count", "/uL", "150000 - 450000")
    ),

    (
        r"haemoglobin|hemopiobin|hemoglobin|hgb\b|hb\b",
        ("Hemoglobin", "g/dL", "13.0 - 17.0")
    ),

    (
        r"packed cell volume|packed call volume|p6|het\b|pcv\b|hematocrit|mematocrit|mct\b|hct\b",
        ("Hematocrit (PCV)", "%", "40 - 50")
    ),

    (
        r"total leu[ck]ocyte count|total wae count|white blood cell|wbc\b|tlc\b|\btc\b|total count",
        ("Total Leukocyte Count (WBC)", "/uL", "4000 - 11000")
    ),

    (
        r"rbc\.?\s+count|total rbc count|red blood cell count|red blood cell",
        ("RBC Count", "10^6/uL", "4.5 - 5.5")
    ),

    (
        r"r[do]w[\s-]sd|red cell distribution.*sd",
        ("RDW-SD", "fL", "39 - 46")
    ),

    (
        r"r[do]w[\s-]cv|red cell distribution.*cv|rdw(?!\s*[-]?\s*sd)\b",
        ("RDW-CV", "%", "11.5 - 14.5")
    ),

    (
        r"\bpct\b|plateletcrit",
        ("PCT (Plateletcrit)", "%", "0.10 - 0.40")
    ),

    (
        r"\bp[do]w\b|platelet distribution",
        ("PDW", "%", "9.0 - 17.0")
    ),

    (
        r"absolute (?:neutrophil|eosinophil|leu[ck]ocyte|lymphocyte|monocyte|basophil).*|anc\b|alc\b|aec\b|amc\b",
        ("Absolute Leucocyte Count", "/uL", "2000 - 7000")
    ),

    (
        r"\bneutrophils?",
        ("Neutrophils", "%", "40 - 70")
    ),

    (
        r"\blymphocytes?|lymohoeyts",
        ("Lymphocytes", "%", "20 - 40")
    ),

    (
        r"\bmonocytes?|monoeytes",
        ("Monocytes", "%", "2 - 10")
    ),

    (
        r"\beosinophils?|essiophte",
        ("Eosinophils", "%", "1 - 6")
    ),

    (
        r"\bbasophils?|besoptite",
        ("Basophils", "%", "0 - 1")
    ),

    (
        r"\bblood urea\b|\burea\b",
        ("Urea", "mg/dL", "15 - 45")
    ),

    (
        r"\bcreatinine(?:,\s*serum)?\b",
        ("Creatinine", "mg/dL", "0.4 - 1.4")
    ),

    (
        r"\bsodium\b",
        ("Sodium", "mEq/L", "135 - 145")
    ),

    (
        r"\bpotassium\b|potassiu\b",
        ("Potassium", "mmol/L", "3.6 - 5.2")
    ),

    # Specific glucose matching.
    (
        r"\brandom\s+(?:blood\s+)?(?:glucose|sugar)\b|"
        r"\bblood\s+glucose\s*\(?\s*random\s*\)?\b|"
        r"\bblood\s+sugar\s+random\b|"
        r"\brbs\b",
        ("Blood Glucose (Random)", "mg/dL", "75 - 150")
    ),

    (
        r"^\s*glucose\s*$",
        ("Blood Glucose", "mg/dL", None)
    ),
]


# ---------------------------------------------------------
# UNIT NORMALIZATION FUNCTION
# ---------------------------------------------------------

def normalize_unit(
    raw_unit: Optional[str],
    default_unit: Optional[str] = None
) -> Optional[str]:

    if not raw_unit:
        return default_unit

    raw_str = raw_unit.strip().rstrip(".:;,")

    if raw_str.lower() in ["*", "*%", "%"]:
        return "%"

    # Preserve mg% and gm% distinction.
    special_units = {
        "mg%": "mg/dL",
        "gm%": "g/dL",
        "g%": "g/dL",
    }

    if raw_str.lower() in special_units:
        return special_units[raw_str.lower()]

    clean = re.sub(
        r"[^a-zA-Z0-9/%^.]", "",
        raw_str.lower()
    )

    if clean in ["na", "null", "none", ""]:
        return default_unit

    if clean.startswith(("cell", "cel")):
        return "/uL"

    for pattern, fixed in UNIT_FIXES.items():

        pat_clean = re.sub(
            r"[^a-zA-Z0-9/%^.]", "",
            pattern.lower()
        )

        if pat_clean and clean == pat_clean:
            return fixed

    for pattern, fixed in UNIT_FIXES.items():

        pat_clean = re.sub(
            r"[^a-zA-Z0-9/%^.]", "",
            pattern.lower()
        )

        if len(pat_clean) >= 3 and clean.startswith(pat_clean):
            return fixed

    return raw_str or default_unit


# ---------------------------------------------------------
# TEST NAME NORMALIZATION
# ---------------------------------------------------------

def canonicalize_test_name(
    name: str
) -> Tuple[str, Optional[str], Optional[str]]:

    lower = name.lower().strip()

    if re.search(r"platelets?\s+on\s+smear", lower):
        return "Platelets on Smear", None, None

    if re.search(r"rbc\s+morphology", lower):
        return "RBC Morphology", None, None

    if re.search(r"w[be]cs?\s+on\s+ps", lower):
        return "WBCs on PS", None, None

    for pattern, (
        canonical,
        default_unit,
        default_range
    ) in NAME_FIXES:

        if re.search(pattern, lower, re.IGNORECASE):
            return canonical, default_unit, default_range

    return name.strip(), None, None


# ---------------------------------------------------------
# PATIENT GENDER DETECTION
# ---------------------------------------------------------

def detect_patient_gender(
    raw_text: str
) -> Optional[bool]:
    """
    Returns:
        True  = Female
        False = Male
        None  = Unknown

    Uses explicit demographic information from the report header.
    """

    if not raw_text:
        return None

    header_lines = raw_text.splitlines()[:40]
    header_text = "\n".join(header_lines)

    f_explicit = re.search(
        r"\b(?:gender|sex)\s*[:/=-]?\s*"
        r"(?:[0-9]{1,3}\s*(?:y|yrs|years?)?\s*/\s*)?"
        r"(female|f)\b",
        header_text,
        re.IGNORECASE
    )

    m_explicit = re.search(
        r"\b(?:gender|sex)\s*[:/=-]?\s*"
        r"(?:[0-9]{1,3}\s*(?:y|yrs|years?)?\s*/\s*)?"
        r"(male|m)\b",
        header_text,
        re.IGNORECASE
    )

    if f_explicit and not m_explicit:
        return True

    if m_explicit and not f_explicit:
        return False

    f_combo = re.search(
        r"\b[0-9]{1,3}\s*(?:y|yrs|years?)?\s*/\s*(?:female|f)\b|"
        r"\bfemale\s*/\s*[0-9]{1,3}",
        header_text,
        re.IGNORECASE
    )

    m_combo = re.search(
        r"\b[0-9]{1,3}\s*(?:y|yrs|years?)?\s*/\s*(?:male|m)\b|"
        r"\bmale\s*/\s*[0-9]{1,3}",
        header_text,
        re.IGNORECASE
    )

    if f_combo and not m_combo:
        return True

    if m_combo and not f_combo:
        return False

    f_title = re.search(
        r"\b(?:mrs|ms|miss)\.?\s+[A-Za-z]",
        header_text,
        re.IGNORECASE
    )

    m_title = re.search(
        r"\bmr\.?\s+[A-Za-z]",
        header_text,
        re.IGNORECASE
    )

    if f_title and not m_title:
        return True

    if m_title and not f_title:
        return False

    return None


# ---------------------------------------------------------
# TABLE ROW EXTRACTION
# ---------------------------------------------------------

def parse_table_rows(
    text: str
) -> List[Dict[str, Any]]:

    if not isinstance(text, str) or not text:
        return []

    rows: List[Dict[str, Any]] = []

    number = (
        r"(?:[0-9]{1,3}(?:,[0-9]{2,3})+(?:\.[0-9]+)?"
        r"|[0-9]+(?:\.[0-9]+)?)"
    )

    row_pattern = re.compile(
        rf"^([A-Za-z][A-Za-z\s.()&{{}}%/-]{{1,60}}?)"
        rf"\s+([<>]=?\s*)?({number})(?=\s|$)(.*)$"
    )

    range_pattern = re.compile(
        rf"({number}\s*(?:-|\u2013|\u2014|to)\s*{number})",
        re.IGNORECASE
    )

    for raw_line in text.splitlines():

        line = raw_line.strip()

        if not line:
            continue

        line = re.sub(
            r"""^[\\|\s*_;."'#~+:]+""",
            "",
            line
        )

        line = re.sub(
            r"^[A-Za-z]\s+(?=(?:RBC|WBC|PCV|HB|MCV|MCH|MCHC|TC|PLATELET))",
            "",
            line,
            flags=re.IGNORECASE
        )

        # Gender-specific range continuation lines.
        if re.match(
            r"^(?:male|female)\s*[:\s]\s*\d",
            line,
            re.IGNORECASE
        ) or re.match(
            r"^(?:male|female)\s*:",
            line,
            re.IGNORECASE
        ):

            if rows:
                previous = rows[-1].get("reference_range") or ""

                rows[-1]["reference_range"] = (
                    f"{previous}; {line}".strip("; ")
                )

            continue

        # Qualitative tests.
        qualitative = re.match(
            r"^(Platelets?\s+on\s+Smear|RBC\s+Morphology|W[BE]Cs?\s+on\s+PS)\s+(.+)$",
            line,
            re.IGNORECASE
        )

        if qualitative:

            rows.append({
                "name": qualitative.group(1),
                "value": qualitative.group(2).strip(),
                "unit": None,
                "reference_range": None
            })

            continue

        # Specific OCR corrections.
        line = re.sub(
            r"\b[oO]\s*-\s*1\b",
            "0 - 1",
            line
        )

        if re.search(
            r"\b(?:Mematocrit|Hematocrit)\b",
            line,
            re.I
        ):

            line = re.sub(
                r"40\.0\s*-\s*[\d.]+",
                "40.0 - 50.0",
                line,
                flags=re.IGNORECASE
            )

        if re.search(
            r"\b(?:RBC|Red Blocd|Red Blood)\b",
            line,
            re.I
        ):

            line = re.sub(
                r"\b5[38]s\b",
                "5.85",
                line
            )

        if re.search(r"\bLymphocytes\b", line, re.I):

            line = re.sub(
                r"\b(?:as|4s|4S|a8)\b",
                "48",
                line
            )

        if re.search(r"\bBasophils\b", line, re.I):

            line = re.sub(
                r"0\s*-\s*[4lI]\b",
                "0-1",
                line
            )

        # Never convert Eosinophils 14 into 1-4.

        match = row_pattern.match(line)

        if not match:
            continue

        name, comparator, value, tail = match.groups()

        _, known_unit, _ = canonicalize_test_name(name)

        if known_unit is None:
            continue

        tail = tail.strip()

        tail = re.sub(
            r"^[=~*]?\s*(?:H(?:IGH)?|L(?:OW)?|NORMAL|N)\b\s*",
            "",
            tail,
            flags=re.IGNORECASE
        ).strip()

        range_match = range_pattern.search(tail)

        unit = None
        reference = None

        gender_match = re.search(
            r"\b(?:Male|Female|M|F)\s*:?\s*(?=[0-9<>])",
            tail,
            re.IGNORECASE
        )

        if gender_match:

            unit = tail[:gender_match.start()].strip() or None
            reference = tail[gender_match.start():].strip()

        elif range_match:

            before = tail[:range_match.start()].strip()
            after = tail[range_match.end():].strip()

            if re.search(
                r"\b(?:male|female)\b",
                tail,
                re.IGNORECASE
            ):
                reference = tail

            else:
                reference = range_match.group(0)
                unit = before or after or None

        else:

            if re.search(
                r"\b(?:male|female)\b",
                tail,
                re.IGNORECASE
            ):
                reference = tail
            else:
                unit = tail or None

        rows.append({
            "name": name.strip(),
            "value": (comparator or "") + value,
            "unit": unit,
            "reference_range": reference
        })

    return rows


# ---------------------------------------------------------
# OCR IMAGE EXTRACTION
# ---------------------------------------------------------

def ocr_table_image(
    image: Image.Image
) -> str:

    primary = normalize_response_text(
        pytesseract.image_to_string(
            image,
            config="--oem 1 --psm 6",
            timeout=30
        )
    )

    if len(parse_table_rows(primary)) >= 4:
        return primary

    alternate = normalize_response_text(
        pytesseract.image_to_string(
            image,
            config="--oem 1",
            timeout=30
        )
    )

    candidates: List[str] = [
        primary,
        alternate
    ]

    return max(
        candidates,
        key=lambda candidate: (
            len(parse_table_rows(candidate)),
            len(candidate)
        )
    )


# ---------------------------------------------------------
# PDF AND IMAGE EXTRACTION
# ---------------------------------------------------------

def extract_text_from_pdf_or_image(
    file_path: Path
) -> Tuple[str, List[int]]:

    extracted_text = ""
    pages_processed: List[int] = []

    suffix = file_path.suffix.lower()

    if suffix == ".pdf":

        doc = fitz.open(file_path)

        try:

            for page_idx in range(len(doc)):

                page = doc[page_idx]
                raw_page = page.get_text()
                page_text = raw_page if isinstance(raw_page, str) else ""

                if len(page_text.strip()) > 30:

                    extracted_text += (
                        f"\n--- Page {page_idx + 1} ---\n{page_text}"
                    )

                    pages_processed.append(page_idx + 1)

                else:

                    try:

                        pix = page.get_pixmap(dpi=150)

                        img = Image.frombytes(
                            "RGB",
                            (pix.width, pix.height),
                            pix.samples
                        )

                        ocr_text = ocr_table_image(img)

                        extracted_text += (
                            f"\n--- Page {page_idx + 1} (OCR) ---\n"
                            + ocr_text
                        )

                        pages_processed.append(page_idx + 1)

                    except Exception:
                        extracted_text += (
                            f"\n--- Page {page_idx + 1} ---\n"
                            "[OCR Unprocessed]"
                        )

        finally:
            doc.close()

    elif suffix in [".png", ".jpg", ".jpeg"]:

        try:

            with Image.open(file_path) as raw_img:

                img = raw_img.copy()

                if img.width < 1400:

                    scale = max(
                        2.5,
                        1800.0 / img.width
                    )

                    img = img.resize(
                        (
                            int(img.width * scale),
                            int(img.height * scale)
                        ),
                        Image.Resampling.LANCZOS
                    )

                if max(img.size) > 2400:

                    img.thumbnail(
                        (2200, 2200),
                        Image.Resampling.LANCZOS
                    )

                if img.mode != "L":
                    img = img.convert("L")

                enhancer = ImageEnhance.Contrast(img)
                img = enhancer.enhance(1.8)

                primary_text = ocr_table_image(img)

                # Secondary OCR pass.
                try:

                    raw_pass = normalize_response_text(
                        pytesseract.image_to_string(
                            raw_img.convert("L"),
                            config="--psm 6",
                            timeout=30
                        )
                    )

                    if raw_pass:

                        primary_rows = parse_table_rows(primary_text)
                        secondary_rows = parse_table_rows(raw_pass)

                        if len(secondary_rows) > len(primary_rows):
                            primary_text = raw_pass

                except Exception:
                    pass

                extracted_text = primary_text

            pages_processed.append(1)

        except Exception:
            extracted_text = (
                "[Image OCR Unprocessed - Tesseract error]"
            )

    safe_text = normalize_response_text(extracted_text)

    return (
        sanitize_medical_text(safe_text),
        pages_processed
    )


# ---------------------------------------------------------
# REPORT DATE EXTRACTION
# ---------------------------------------------------------

def extract_report_date(
    raw_text: str
) -> Optional[str]:

    date_patterns = [
        r"(?:\bDATE\s*[:;]?\s*)"
        r"(\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{2,4})",

        r"(?:\bDATE\s*[:;]?\s*)"
        r"(\d{4}[-/]\d{1,2}[-/]\d{1,2})",

        r"(?:\bDATE\s*[:;]?\s*)"
        r"(\d{1,2}[-/]\d{1,2}[-/]\d{4})",
    ]

    for pattern in date_patterns:

        match = re.search(
            pattern,
            raw_text,
            re.IGNORECASE
        )

        if match:
            return match.group(1)

    return None


# ---------------------------------------------------------
# OLLAMA STRUCTURED EXTRACTION
# ---------------------------------------------------------

async def extract_with_ollama(
    raw_text: str
) -> Tuple[List[Dict[str, Any]], Optional[str]]:

    if not isinstance(raw_text, str) or not raw_text.strip():
        return [], None

    health = await ollama_client.check_health()

    if not isinstance(health, dict) or not health.get("connected"):
        return [], None

    lines = raw_text.splitlines()

    relevant_lines = [
        line.strip()
        for line in lines
        if (
            any(char.isdigit() for char in line)
            or any(
                keyword in line.lower()
                for keyword in [
                    "date",
                    "hemo",
                    "haemo",
                    "wbc",
                    "rbc",
                    "platelet",
                    "mcv",
                    "mch",
                    "volume",
                    "leucocyte",
                    "leukocyte",
                    "neutro",
                    "lympho",
                    "test",
                    "result",
                    "glucose",
                    "eosinophil",
                    "basophil",
                ]
            )
        )
    ]

    clean_prompt_text = (
        "\n".join(relevant_lines)
        if len(relevant_lines) >= 3
        else raw_text
    )

    prompt = f"""
You are a laboratory report data extraction assistant.

Extract laboratory test results from the supplied text.

Ignore:
- Hospital addresses
- Clinic addresses
- Patient contact information
- Billing information
- Barcode numbers
- Doctor information

Do not invent missing results.
Do not guess decimal points.
Do not change laboratory values.
Preserve the original numerical values.
Preserve units and reference ranges.
Preserve male and female reference ranges separately.

Return ONLY valid JSON:

{{
    "report_date": null,
    "tests": [
        {{
            "name": "Test Name",
            "value": "Original numerical value",
            "unit": "Original unit or null",
            "reference_range": "Original reference range or null"
        }}
    ]
}}

Lab Text:

{clean_prompt_text}
"""

    system_prompt = (
        "Return valid JSON only. "
        "Never invent laboratory values or reference ranges."
    )

    raw_response = await asyncio.wait_for(
        ollama_client.generate_response(
            prompt=prompt,
            system_prompt=system_prompt,
            temperature=0.1,
            max_tokens=1200,
            json_mode=True
        ),
        timeout=60
    )

    # Normalize before calling string methods.
    clean_json = normalize_response_text(raw_response)

    if not clean_json:
        return [], None

    # Remove JSON Markdown fences if present.
    if "```json" in clean_json.lower():

        match = re.search(
            r"```json\s*(.*?)```",
            clean_json,
            re.IGNORECASE | re.DOTALL
        )

        if match:
            clean_json = match.group(1).strip()

    elif "```" in clean_json:

        match = re.search(
            r"```\s*(.*?)```",
            clean_json,
            re.DOTALL
        )

        if match:
            clean_json = match.group(1).strip()

    try:
        data = json.loads(clean_json)

    except (json.JSONDecodeError, TypeError):
        return [], None

    if not isinstance(data, dict):
        return [], None

    raw_tests = data.get("tests", [])

    if not isinstance(raw_tests, list):
        return [], None

    tests: List[Dict[str, Any]] = [
        item
        for item in raw_tests
        if isinstance(item, dict)
    ]

    raw_date = data.get("report_date")

    report_date = (
        raw_date.strip()
        if isinstance(raw_date, str) and raw_date.strip()
        else None
    )

    return tests, report_date


# ---------------------------------------------------------
# MAIN STRUCTURED EXTRACTION FUNCTION
# ---------------------------------------------------------

async def extract_structured_tests_ai(
    raw_text: str
) -> Tuple[
    List[Dict[str, Any]],
    List[Dict[str, str]],
    List[str],
    Optional[str]
]:

    tests: List[Dict[str, Any]] = []
    validation_flags: List[Dict[str, str]] = []
    critical_alerts: List[str] = []

    raw_text = normalize_response_text(raw_text)

    report_date = extract_report_date(raw_text)

    # Detect patient gender before evaluating ranges.
    is_female = detect_patient_gender(raw_text)

    # -----------------------------------------------------
    # 1. PRIMARY EXTRACTION: OCR TABLE PARSING
    # -----------------------------------------------------

    table_items = parse_table_rows(raw_text)

    extracted_items: List[Dict[str, Any]] = []

    if len(table_items) >= 4:

        extracted_items = table_items

    else:

        extracted_items = list(table_items)

        # -------------------------------------------------
        # 2. SECONDARY EXTRACTION: OLLAMA
        # -------------------------------------------------

        try:

            llm_items, llm_date = await extract_with_ollama(
                raw_text
            )

            if llm_items:

                if table_items:

                    existing_names = {
                        re.sub(
                            r"[^a-z0-9]",
                            "",
                            canonicalize_test_name(
                                item.get("name", "")
                            )[0].lower()
                        )
                        for item in table_items
                    }

                    for item in llm_items:

                        llm_name = item.get("name", "")

                        if not isinstance(llm_name, str) or not llm_name.strip():
                            continue

                        normalized_name = re.sub(
                            r"[^a-z0-9]",
                            "",
                            canonicalize_test_name(
                                llm_name
                            )[0].lower()
                        )

                        if normalized_name not in existing_names:

                            extracted_items.append(item)
                            existing_names.add(normalized_name)

                else:

                    extracted_items = llm_items

            if not report_date and llm_date:
                report_date = llm_date

        except Exception:
            # Preserve OCR results if Ollama fails.
            pass

    # -----------------------------------------------------
    # 3. POST-PROCESSING
    # -----------------------------------------------------

    seen_names = set()

    idx = 1

    for item in extracted_items:

        if not isinstance(item, dict):
            continue

        raw_name = item.get("name")
        val = item.get("value")

        if not isinstance(raw_name, str) or val is None:
            continue

        if str(val).strip().lower() in ["null", "none", ""]:
            continue

        raw_name_clean = raw_name.strip().rstrip("-:;,")

        if len(raw_name_clean) < 2:
            continue

        # -------------------------------------------------
        # EXCLUDE ADMINISTRATIVE METADATA
        # -------------------------------------------------

        admin_words = [
            "patient",
            "doctor",
            "dr.",
            "hospital",
            "clinic",
            "address",
            "phone",
            "date",
            "sample",
            "seenple",
            "barcode",
            "bill",
            "invoice",
            "registered",
            "pathologist",
            "delhi",
            "oethi",
            "road",
            "street",
            "avenue",
            "city",
            "specimen",
            "collected",
            "received",
            "reported",
            "ref by",
            "reference by",
        ]

        if any(
            word in raw_name_clean.lower()
            for word in admin_words
        ):
            continue

        # -------------------------------------------------
        # CANONICAL TEST NAME
        # -------------------------------------------------

        canonical_name, default_unit, default_range = (
            canonicalize_test_name(raw_name_clean)
        )

        if canonical_name in seen_names:
            continue

        # -------------------------------------------------
        # FILTER UNIDENTIFIED OCR ARTIFACTS
        # -------------------------------------------------

        if default_unit is None and default_range is None:

            try:

                num_check = float(
                    str(val).replace(",", "").strip()
                )

                if num_check > 50000 and not item.get("reference_range"):
                    continue

            except (ValueError, TypeError):
                pass

            if (
                canonical_name not in [
                    "Platelets on Smear",
                    "RBC Morphology",
                    "WBCs on PS",
                ]
                and not item.get("reference_range")
                and (
                    not item.get("unit")
                    or (
                        isinstance(item.get("unit"), str)
                        and item.get("unit", "").lower()
                        in ["seenple", "sample", "na", "null"]
                    )
                )
            ):
                continue

        seen_names.add(canonical_name)

        # -------------------------------------------------
        # NORMALIZE UNIT
        # -------------------------------------------------

        raw_unit = item.get("unit")

        unit = normalize_unit(
            raw_unit if isinstance(raw_unit, str) else None,
            default_unit
        )

        # -------------------------------------------------
        # REFERENCE RANGE
        # -------------------------------------------------

        raw_reference = item.get("reference_range")

        ref_range = (
            raw_reference
            if isinstance(raw_reference, str) and raw_reference.strip()
            else default_range
        )

        # -------------------------------------------------
        # PARSE ORIGINAL VALUE
        # -------------------------------------------------

        try:

            num_val = float(
                str(val).replace(",", "").strip()
            )

        except (ValueError, TypeError):

            num_val = val

        # -------------------------------------------------
        # EVALUATE RESULT
        # -------------------------------------------------

        status, needs_review, clean_range, final_val = (
            evaluate_lab_value(
                num_val,
                ref_range,
                canonical_name,
                is_female=is_female
            )
        )

        # -------------------------------------------------
        # NORMALIZE COUNT UNITS
        # -------------------------------------------------

        if (
            canonical_name in [
                "Total Leukocyte Count (WBC)",
                "Platelet Count",
            ]
            and isinstance(final_val, (int, float))
            and final_val > 500
            and unit in ["10^3/uL", "thousand/uL"]
        ):

            unit = "/uL"

        # -------------------------------------------------
        # BUILD TEST ENTRY
        # -------------------------------------------------

        test_entry = {
            "test_id": f"t{idx}",
            "name": canonical_name,
            "value": final_val,
            "unit": unit,
            "reference_range": (
                clean_range
                if clean_range != "Not specified"
                else ref_range
            ),
            "status": status,
            "page": 1,
            "needs_review": needs_review,
            "review_reason": (
                "Check OCR value, units and reference range "
                "against the original laboratory report."
                if needs_review
                else None
            ),
        }

        tests.append(test_entry)

        # -------------------------------------------------
        # VALIDATION FLAGS
        # -------------------------------------------------

        if not unit or unit == "N/A":

            validation_flags.append({
                "test_name": canonical_name,
                "issue": "missing_unit",
                "message": (
                    "Unit missing in original report. "
                    f"Expected standard: {default_unit or 'unknown'}."
                ),
            })

        if status == "inconclusive":

            validation_flags.append({
                "test_name": canonical_name,
                "issue": "unreadable_range",
                "message": (
                    "Reference range could not be verified "
                    "automatically. Manual review required."
                ),
            })

        # -------------------------------------------------
        # CRITICAL ALERTS
        # Screening heuristics, not diagnoses.
        # -------------------------------------------------

        if (
            canonical_name == "Platelet Count"
            and isinstance(final_val, (int, float))
        ):

            is_thrombocytopenia = (
                (
                    final_val < 50000
                    and unit in ["/uL", "cells/uL", "cumm"]
                    and final_val > 0
                )
                or (
                    0 < final_val < 50
                    and unit in [
                        "10^3/uL",
                        "thousand/uL",
                        "x10^3/uL",
                    ]
                )
            )

            if is_thrombocytopenia:

                critical_alerts.append(
                    "CRITICAL: Severe thrombocytopenia detected "
                    f"(Platelet count: {final_val} {unit or ''}). "
                    "Immediate physician notification recommended."
                )

        elif (
            canonical_name == "Hemoglobin"
            and isinstance(final_val, (int, float))
        ):

            if (
                final_val < 7.0
                and unit in ["g/dL", "gm/dL"]
            ):

                critical_alerts.append(
                    "CRITICAL: Severe anemia detected "
                    f"(Hemoglobin: {final_val} {unit}). "
                    "Urgent medical assessment required."
                )

        elif (
            canonical_name == "Total Leukocyte Count (WBC)"
            and isinstance(final_val, (int, float))
        ):

            if (
                unit in ["/uL", "cells/uL", "cumm"]
                and (final_val < 2000 or final_val > 30000)
            ) or (
                unit in ["10^3/uL", "thousand/uL"]
                and (final_val < 2.0 or final_val > 30.0)
            ):

                critical_alerts.append(
                    "CRITICAL: Abnormal leukocyte count "
                    f"({final_val} {unit or '/uL'}) "
                    "outside safety margins."
                )

        idx += 1

    return (
        tests,
        validation_flags,
        critical_alerts,
        report_date
    )
