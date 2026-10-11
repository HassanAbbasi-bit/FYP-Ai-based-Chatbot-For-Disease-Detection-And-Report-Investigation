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
    "pe": "pg",
    "m2": "%",
    "*": "%",
    "e/dt": "g/dL",
    "cells/yal": "/uL",
    "cells/pat": "/uL",
    "million/st": "10^6/uL",
}

# Standard test name canonicalization
NAME_FIXES = {
    r"haemoglobin|hemopiobin|hemoglobin|hgb\b|hb\b": ("Hemoglobin", "g/dL", "13.0 - 17.0"),
    r"total leucocyte count|total wae count|white blood cell|wbc\b|tlc\b": ("Total Leukocyte Count (WBC)", "/uL", "4000 - 10000"),
    r"platelet count|platelets?|plt\b": ("Platelet Count", "/uL", "150000 - 410000"),
    r"packed call volume|packed cell volume|p6|het\b|pcv\b|hematocrit|mematocrit|hct\b": ("Hematocrit (PCV)", "%", "40 - 50"),
    r"mean corpuscuar volume|mean corpuscular volume|mcv\b": ("MCV (Mean Corpuscular Volume)", "fL", "81 - 101"),
    r"mch\b": ("MCH", "pg", "27 - 32"),
    r"mchc\b": ("MCHC", "g/dL", "31.5 - 34.5"),
    r"rbc count|total rbc count|red blood cell count|red blood cell": ("RBC Count", "10^6/uL", "4.5 - 5.5"),
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
    falls back to Tesseract OCR with adaptive resolution scaling.
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
            with Image.open(file_path) as img:
                # Speed & accuracy: upscale low-res images (<1400px) so character height is readable
                if img.width < 1400:
                    scale = 1600.0 / img.width
                    img = img.resize((int(img.width * scale), int(img.height * scale)), Image.Resampling.LANCZOS)
                elif max(img.size) > 2200:
                    img.thumbnail((2000, 2000), Image.Resampling.LANCZOS)
                
                # Convert to grayscale
                if img.mode != "L":
                    img = img.convert("L")
                
                # Enhance contrast to sharpen faint laboratory receipt text
                from PIL import ImageEnhance
                enhancer = ImageEnhance.Contrast(img)
                img = enhancer.enhance(1.8)

                extracted_text = pytesseract.image_to_string(img, config="--oem 1")
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

    # 1. Primary Strategy: Ultra-Fast Table Regex Extractor (< 5ms)
    lines = raw_text.splitlines()
    num_pattern = r"([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)"
    row_pattern = rf"^([A-Za-z\s()&{{}}\-]{{3,45}}?)\s+{num_pattern}\s*([A-Za-z/%*.]+)?\s*(?:([0-9]+(?:\.[0-9]+)?\s*[-–to]\s*[0-9]+(?:\.[0-9]+)?))?"
    
    table_items = []
    ignored_keywords = [
        "patient", "doctor", "dr.", "test name", "hospital", "clinic", "address", 
        "phone", "date", "sample", "barcode", "bill", "invoice", "registered", 
        "pathologist", "complete blood", "report status", "collection type", "avenue", 
        "district", "delhi", "road", "street", "pin", "zip", "tel"
    ]
    for line in lines:
        line_clean = line.strip()
        match = re.search(row_pattern, line_clean)
        if match:
            t_name = match.group(1).strip()
            t_val = match.group(2)
            t_unit = match.group(3)
            t_range = match.group(4)
            if len(t_name) > 2 and not any(kw in t_name.lower() for kw in ignored_keywords):
                table_items.append({
                    "name": t_name,
                    "value": t_val,
                    "unit": t_unit,
                    "reference_range": t_range
                })

    # If fast table parsing detected 4+ tests, use them immediately (runs in < 0.01s)
    if len(table_items) >= 4:
        extracted_items = table_items
        date_match = re.search(r"(\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})", raw_text)
        if date_match:
            report_date = date_match.group(1)
    else:
        # 2. Secondary Strategy: Ollama LLM Structured Extraction for complex/unstructured formats
        try:
            health = await ollama_client.check_health()
            if health.get("connected"):
                lines = raw_text.splitlines()
                relevant_lines = [s.strip() for s in lines if any(c.isdigit() for c in s) or any(k in s.lower() for k in ["date", "hemo", "haemo", "wbc", "rbc", "platelet", "mcv", "mch", "volume", "leucocyte", "neutro", "lympho", "test", "result"])]
                clean_prompt_text = "\n".join(relevant_lines) if len(relevant_lines) >= 3 else raw_text

                prompt = f"""You are a specialized medical laboratory report data extractor.
Extract all clinical laboratory test results from the text into strict, valid JSON.
Ignore clinic headers and addresses.
Return ONLY valid JSON matching this schema:
{{
  "report_date": "YYYY-MM-DD or null",
  "tests": [
    {{
      "name": "Test Name",
      "value": "full numerical value (e.g. 4200 or 14.5)",
      "unit": "unit or null",
      "reference_range": "reference range or null"
    }}
  ]
}}

Lab Text:
{clean_prompt_text}
"""
                system_prompt = "Return valid JSON only. Never include conversational text."
                raw_response = await ollama_client.generate_response(prompt=prompt, system_prompt=system_prompt, temperature=0.1, max_tokens=550, json_mode=True)
                
                clean_json = raw_response.strip()
                if "```json" in clean_json:
                    clean_json = clean_json.split("```json")[1].split("```")[0].strip()
                elif "```" in clean_json:
                    clean_json = clean_json.split("```")[1].split("```")[0].strip()

                data = json.loads(clean_json)
                extracted_items = data.get("tests", [])
                report_date = data.get("report_date")
        except Exception:
            extracted_items = table_items

    # 3. Post-Processing: Standardize names, units, and evaluate reference ranges
    seen_names = set()
    idx = 1
    for item in extracted_items:
        raw_name = item.get("name")
        val = item.get("value")
        
        # Skip section headings, non-medical lines, or empty values
        if not raw_name or val is None or str(val).lower() in ["null", "none", ""]:
            continue
        if any(w in raw_name.lower() for w in ["patient", "doctor", "dr.", "hospital", "clinic", "address", "phone", "date", "sample", "barcode", "bill", "invoice", "registered", "pathologist"]):
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

        # Handle common OCR decimal point missing in values
        if isinstance(num_val, (int, float)):
            # RBC Count: e.g. 500 -> 5.0
            if canonical_name == "RBC Count" and 100 <= num_val <= 700:
                num_val = round(num_val / 100.0, 2)
            # PCT: e.g. 35 -> 0.35
            elif canonical_name == "PCT (Plateletcrit)" and 10 <= num_val <= 90:
                num_val = round(num_val / 100.0, 2)
            # Hemoglobin: e.g. 172 -> 17.2
            elif canonical_name == "Hemoglobin" and 90 <= num_val <= 250:
                num_val = round(num_val / 10.0, 1)
            # Hematocrit: e.g. 516 -> 51.6
            elif canonical_name == "Hematocrit (PCV)" and 300 <= num_val <= 700:
                num_val = round(num_val / 10.0, 1)
            # MCV: e.g. 832 -> 83.2
            elif canonical_name == "MCV (Mean Corpuscular Volume)" and 500 <= num_val <= 1300:
                num_val = round(num_val / 10.0, 1)
            # MCH: e.g. 294 -> 29.4
            elif canonical_name == "MCH" and 200 <= num_val <= 450:
                num_val = round(num_val / 10.0, 1)
            # MCHC: e.g. 333 -> 33.3
            elif canonical_name == "MCHC" and 250 <= num_val <= 450 and num_val > 100:
                num_val = round(num_val / 10.0, 1)
            # RDW-CV: e.g. 148 -> 14.8
            elif canonical_name == "RDW-CV" and 100 <= num_val <= 250:
                num_val = round(num_val / 10.0, 1)
            # MPV: e.g. 73 -> 7.3
            elif canonical_name == "MPV" and 50 <= num_val <= 160:
                num_val = round(num_val / 10.0, 1)

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
