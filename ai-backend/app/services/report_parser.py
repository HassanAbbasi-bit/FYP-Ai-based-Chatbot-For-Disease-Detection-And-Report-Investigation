import re
import json
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
import pymupdf as fitz
from PIL import Image
import pytesseract

from app.config import settings
from app.core.security import sanitize_medical_text
from app.services.range_checker import evaluate_lab_value
from app.core.ollama_client import ollama_client

if Path(settings.TESSERACT_CMD).exists():
    pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD

# Standard unit cleanup dictionary
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
    "m2": "%",
    "*": "%",
}

# Standard test name canonicalization
NAME_FIXES = {
    r"haemoglobin|hemopiobin|hemoglobin|hgb\b|hb\b": ("Hemoglobin", "g/dL", "13.0 - 17.0"),
    r"total leucocyte count|total wae count|white blood cell|wbc\b": ("Total Leukocyte Count (WBC)", "/uL", "4000 - 10000"),
    r"platelet count|platelets?|plt\b": ("Platelet Count", "/uL", "150000 - 410000"),
    r"packed call volume|packed cell volume|p6|het\b|pcv\b|hematocrit": ("Hematocrit (PCV)", "%", "40 - 50"),
    r"mean corpuscuar volume|mean corpuscular volume|mcv\b": ("MCV (Mean Corpuscular Volume)", "fL", "81 - 101"),
    r"mch\b": ("MCH", "pg", "27 - 32"),
    r"mchc\b": ("MCHC", "g/dL", "31.5 - 34.5"),
    r"rbc count|total rbc count|red blood cell": ("RBC Count", "10^6/uL", "4.5 - 5.5"),
    r"neutrophils?": ("Neutrophils", "%", "40 - 80"),
    r"lymphocytes?|lymohoeyts": ("Lymphocytes", "%", "20 - 40"),
    r"eosinophils?|essiophte": ("Eosinophils", "%", "1 - 6"),
    r"monocytes?|monoeytes": ("Monocytes", "%", "2 - 10"),
    r"basophils?|besoptite": ("Basophils", "%", "0 - 1"),
    r"absolute leu[ck]ocyte count|alc\b": ("Absolute Leucocyte Count", "/uL", "2000 - 7000"),
    r"mpv\b": ("MPV", "fL", "7.5 - 11.5"),
    r"r[do]w[\s-]cv|red cell distribution.*cv|rdw\b": ("RDW-CV", "%", "11.6 - 14.0"),
    r"r[do]w[\s-]sd|red cell distribution.*sd": ("RDW-SD", "fL", "39 - 46"),
    r"\bpct\b|plateletcrit": ("PCT (Plateletcrit)", "%", "0.10 - 0.40"),
    r"\bp[do]w\b|platelet distribution": ("PDW", "%", "9.0 - 17.0"),
}

def normalize_unit(raw_unit: Optional[str], default_unit: Optional[str] = None) -> Optional[str]:
    if not raw_unit:
        return default_unit
    clean = re.sub(r"[^a-zA-Z0-9/%^.]", "", raw_unit.lower())
    if clean in ["na", "null", "none", ""]:
        return default_unit
    for pattern, fixed in UNIT_FIXES.items():
        if clean == pattern or clean.startswith(pattern):
            return fixed
    return raw_unit.strip()

def canonicalize_test_name(name: str) -> Tuple[str, Optional[str], Optional[str]]:
    lower = name.lower()
    for pattern, (canonical, def_unit, def_range) in NAME_FIXES.items():
        if re.search(pattern, lower):
            return canonical, def_unit, def_range
    return name.strip(), None, None

def extract_text_from_pdf_or_image(file_path: Path) -> Tuple[str, List[int]]:
    """
    Extracts text from PDF using PyMuPDF. If pages have no digital text or file is an image,
    falls back to Tesseract OCR.
    """
    extracted_text = ""
    pages_processed = []
    
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        doc = fitz.open(file_path)
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            page_text = page.get_text()
            
            if len(page_text.strip()) > 30:
                extracted_text += f"\n--- Page {page_idx + 1} ---\n" + page_text
                pages_processed.append(page_idx + 1)
            else:
                try:
                    pix = page.get_pixmap(dpi=150)
                    img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
                    ocr_text = pytesseract.image_to_string(img)
                    extracted_text += f"\n--- Page {page_idx + 1} (OCR) ---\n" + ocr_text
                    pages_processed.append(page_idx + 1)
                except Exception:
                    extracted_text += f"\n--- Page {page_idx + 1} ---\n[OCR Unprocessed]"
        doc.close()
    elif suffix in [".png", ".jpg", ".jpeg"]:
        try:
            img = Image.open(file_path)
            extracted_text = pytesseract.image_to_string(img)
            pages_processed.append(1)
        except Exception:
            extracted_text = "[Image OCR Unprocessed - Tesseract error]"

    return sanitize_medical_text(extracted_text), pages_processed

async def extract_structured_tests_ai(raw_text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]], List[str], Optional[str]]:
    """
    Extracts lab test results using llama3.2:3b with heuristic fallback,
    standardizes test names and units, and evaluates ranges deterministically.
    """
    tests: List[Dict[str, Any]] = []
    validation_flags: List[Dict[str, str]] = []
    critical_alerts: List[str] = []
    report_date: Optional[str] = None

    extracted_items = []

    # 1. Primary Strategy: LLM Structured Extraction
    try:
        health = await ollama_client.check_health()
        if health.get("connected"):
            prompt = f"""You are a specialized medical laboratory report data extractor.
Extract all clinical laboratory test results from the OCR text into strict, valid JSON.
Ignore hospital address, doctors, and general headers.
Return ONLY valid JSON matching this schema:
{{
  "report_date": "YYYY-MM-DD or null",
  "tests": [
    {{
      "name": "Test Name",
      "value": "numerical or text value",
      "unit": "unit or null",
      "reference_range": "reference range or null"
    }}
  ]
}}

OCR Text:
{raw_text}
"""
            system_prompt = "Return valid JSON only. Never include conversational text."
            raw_response = await ollama_client.generate_response(prompt=prompt, system_prompt=system_prompt, temperature=0.1)
            
            clean_json = raw_response.strip()
            if "```json" in clean_json:
                clean_json = clean_json.split("```json")[1].split("```")[0].strip()
            elif "```" in clean_json:
                clean_json = clean_json.split("```")[1].split("```")[0].strip()

            data = json.loads(clean_json)
            extracted_items = data.get("tests", [])
            report_date = data.get("report_date")
    except Exception:
        # Fallback to heuristic parser if LLM fails
        extracted_items = []

    # 2. Secondary Strategy: Regex Line-by-Line Fallback
    if not extracted_items:
        lines = raw_text.splitlines()
        for line in lines:
            line_clean = line.strip()
            # Match pattern: Name Value [Optional Range/Unit]
            match = re.search(r"^([A-Za-z\s()]+?)\s+([0-9]+(?:\.[0-9]+)?)\s*(?:([0-9]+(?:\.[0-9]+)?\s*[-–to]\s*[0-9]+(?:\.[0-9]+)?))?\s*([A-Za-z/%*.]+)?", line_clean)
            if match:
                t_name = match.group(1).strip()
                t_val = match.group(2)
                t_range = match.group(3)
                t_unit = match.group(4)
                if len(t_name) > 2 and not any(kw in t_name.lower() for kw in ["age", "phone", "date", "dr", "lab", "page", "result"]):
                    extracted_items.append({
                        "name": t_name,
                        "value": t_val,
                        "unit": t_unit,
                        "reference_range": t_range
                    })

    # 3. Post-Processing: Standardize names, units, and evaluate reference ranges
    seen_names = set()
    idx = 1
    for item in extracted_items:
        raw_name = item.get("name")
        val = item.get("value")
        
        # Skip section headings or empty values
        if not raw_name or val is None or str(val).lower() in ["null", "none", ""]:
            continue

        canonical_name, default_unit, default_range = canonicalize_test_name(raw_name)
        if canonical_name in seen_names:
            continue
        seen_names.add(canonical_name)

        unit = normalize_unit(item.get("unit"), default_unit)
        ref_range = item.get("reference_range") or default_range

        # Parse numeric value if possible
        try:
            num_val = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            num_val = val

        # Handle common OCR decimal point missing in values (e.g. RBC 500 -> 5.0)
        if canonical_name == "RBC Count" and isinstance(num_val, (int, float)):
            if 100 <= num_val <= 700:
                num_val = round(num_val / 100.0, 2)

        # Handle common OCR decimal point missing in PCT (e.g. 35 -> 0.35)
        if canonical_name == "PCT (Plateletcrit)" and isinstance(num_val, (int, float)):
            if 10 <= num_val <= 90:
                num_val = round(num_val / 100.0, 2)

        status, needs_review, clean_range = evaluate_lab_value(num_val, ref_range, canonical_name)

        test_entry = {
            "test_id": f"t{idx}",
            "name": canonical_name,
            "value": num_val,
            "unit": unit or "N/A",
            "reference_range": clean_range or ref_range or "Not specified",
            "status": status,
            "page": 1,
            "needs_review": needs_review,
            "review_reason": f"Value ({num_val}) outside reference range ({clean_range})" if status in ["low", "high"] else None
        }
        tests.append(test_entry)

        # Validation flags
        if not unit or unit == "N/A":
            validation_flags.append({
                "test_name": canonical_name,
                "issue": "missing_unit",
                "message": f"Unit missing in original report. Expected standard: {default_unit or 'unknown'}."
            })
        elif status == "inconclusive":
            validation_flags.append({
                "test_name": canonical_name,
                "issue": "unreadable_range",
                "message": "Reference range could not be verified automatically."
            })

        # Critical Alerts Check
        if canonical_name == "Platelet Count" and isinstance(num_val, (int, float)):
            if num_val < 50000 or (num_val < 50 and num_val > 0):
                critical_alerts.append(f"CRITICAL: Severe thrombocytopenia detected (Platelet count: {num_val}). Immediate physician notification recommended.")
        elif canonical_name == "Hemoglobin" and isinstance(num_val, (int, float)):
            if num_val < 7.0:
                critical_alerts.append(f"CRITICAL: Severe anemia detected (Hemoglobin: {num_val} g/dL). Urgent medical assessment required.")
        elif canonical_name == "Total Leukocyte Count (WBC)" and isinstance(num_val, (int, float)):
            if num_val < 2000 or num_val > 30000:
                critical_alerts.append(f"CRITICAL: Abnormal leukocyte count ({num_val} /uL) outside safety margins.")

        idx += 1

    return tests, validation_flags, critical_alerts, report_date
