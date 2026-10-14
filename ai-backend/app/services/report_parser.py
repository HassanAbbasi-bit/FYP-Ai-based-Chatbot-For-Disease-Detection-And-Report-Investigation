import re
import json
import asyncio
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
import pymupdf as fitz
from PIL import Image
import pytesseract

from app.config import settings
from app.core.security import sanitize_medical_text
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
    "%": "%",
    "*%": "%",
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
    r"rbc\.?\s+count|total rbc count|red blood cell count|red blood cell": ("RBC Count", "10^6/uL", "4.5 - 5.5"),
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
    # Qualitative smear observations are separate from numeric cell counts.
    if re.search(r"platelets? on smear", lower):
        return "Platelets on Smear", None, None
    if re.search(r"rbc morphology", lower):
        return "RBC Morphology", None, None
    if re.search(r"w[be]cs? on ps", lower):
        return "WBCs on PS", None, None
    for pattern, (canonical, def_unit, def_range) in NAME_FIXES.items():
        if re.search(pattern, lower):
            return canonical, def_unit, def_range
    return name.strip(), None, None


def ocr_table_image(image: Image.Image) -> str:
    # Automatic page segmentation can emit an entire name column before the
    # result column. A single text block preserves row alignment in CBC scans.
    text = pytesseract.image_to_string(image, config="--oem 1 --psm 6", timeout=30)
    if len(parse_table_rows(text)) >= 4:
        return text
    alternate = pytesseract.image_to_string(image, config="--oem 1", timeout=30)
    return max((text, alternate), key=lambda candidate: len(parse_table_rows(candidate)))


def parse_table_rows(text: str) -> List[Dict[str, Any]]:
    rows = []
    number = r"(?:[0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)"
    row_pattern = re.compile(rf"^([A-Za-z][A-Za-z\s.()&{{}}%/-]{{1,60}}?)\s+([<>]=?\s*)?({number})(?=\s|$)(.*)$")
    range_pattern = re.compile(rf"({number}\s*(?:-|\u2013|to)\s*{number})")
    for line in text.splitlines():
        line = line.strip()
        if re.match(r"^(?:male|female)\s*:", line, re.I):
            if rows:
                rows[-1]['reference_range'] = ((rows[-1].get('reference_range') or '') + '; ' + line).strip('; ')
            continue
        qualitative = re.match(r"^(Platelets? on Smear|RBC Morphology|W[BE]Cs? on PS)\s+(.+)$", line, re.I)
        if qualitative:
            rows.append(dict(name=qualitative[1], value=qualitative[2], unit=None, reference_range=None))
            continue
        match = row_pattern.match(line)
        if not match:
            continue
        name, comparator, value, tail = match.groups()
        _, known_unit, _ = canonicalize_test_name(name)
        # Only recognized CBC measurements may enter through this fast path;
        # age, lab numbers, phone numbers and other header metadata are excluded.
        if known_unit is None:
            continue
        tail = tail.strip()
        range_match = range_pattern.search(tail)
        unit, reference = None, None
        if range_match:
            before = tail[:range_match.start()].strip()
            after = tail[range_match.end():].strip()
            if re.search(r"\b(?:male|female)\b", before, re.I):
                reference = tail
            else:
                reference = range_match[0]
                unit = before or after or None
        else:
            unit = tail or None
        rows.append(dict(name=name.strip(), value=(comparator or '') + value, unit=unit, reference_range=reference))
    return rows


def evaluate_source_value(value: Any, reference: Optional[str]) -> Tuple[str, bool, str]:
    # Never repair decimals or substitute a population range for printed data.
    original = reference or "Not specified"
    if isinstance(value, (int, float)):
        match = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*(?:-|\u2013|to)\s*(\d+(?:\.\d+)?)\s*", reference or '')
        if match:
            low, high = map(float, match.groups())
            if low <= high:
                return ('low' if value < low else 'high' if value > high else 'normal'), True, original
    return 'inconclusive', True, original

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

                extracted_text = ocr_table_image(img)
            pages_processed.append(1)
        except Exception:
            extracted_text = "[Image OCR Unprocessed - Tesseract error]"

    return sanitize_medical_text(extracted_text), pages_processed

async def extract_structured_tests_ai(raw_text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]], List[str], Optional[str]]:
    """
    Extracts aligned OCR rows first, with a bounded model fallback.
    Preserves printed values, units and ranges for user review.
    """
    tests: List[Dict[str, Any]] = []
    validation_flags: List[Dict[str, str]] = []
    critical_alerts: List[str] = []
    report_date: Optional[str] = None

    extracted_items = []

    # Preserve OCR rows before considering model extraction.
    table_items = parse_table_rows(raw_text)

    # Clear tables do not need a model request.
    if len(table_items) >= 4:
        extracted_items = table_items
        date_match = re.search(r"(?:\bDATE\s*:?\s*)(\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{4})", raw_text, re.I)
        if date_match:
            report_date = date_match.group(1)
    else:
        extracted_items = table_items  # Preserve parsed rows when the model is offline.
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
                raw_response = await asyncio.wait_for(ollama_client.generate_response(prompt=prompt, system_prompt=system_prompt, temperature=0.1, max_tokens=550, json_mode=True), timeout=60)
                
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
        raw_name_clean = raw_name.strip().rstrip("-:;,")
        if not raw_name_clean or len(raw_name_clean) < 2:
            continue
        admin_words = [
            "patient", "doctor", "dr.", "hospital", "clinic", "address", "phone", 
            "date", "sample", "seenple", "barcode", "bill", "invoice", "registered", 
            "pathologist", "delhi", "oethi", "road", "street", "avenue", "city",
            "specimen", "collected", "received", "reported", "ref by", "reference by"
        ]
        if any(w in raw_name.lower() for w in admin_words):
            continue

        canonical_name, default_unit, default_range = canonicalize_test_name(raw_name_clean)
        if canonical_name in seen_names:
            continue

        # If not a recognized canonical medical test, ensure it's not a postal code or non-test artifact
        if default_unit is None and default_range is None:
            try:
                num_check = float(str(val).replace(",", "").strip())
                if num_check > 50000 and not item.get("reference_range"):
                    continue
            except (ValueError, TypeError):
                pass
            if canonical_name not in ["Platelets on Smear", "RBC Morphology", "WBCs on PS"] and not item.get("reference_range") and (not item.get("unit") or item.get("unit").lower() in ["seenple", "sample", "na", "null"]):
                continue

        seen_names.add(canonical_name)

        unit = item.get("unit") or None
        ref_range = item.get("reference_range") or None

        # Parse numeric value if possible
        try:
            num_val = float(str(val).replace(",", "").strip())
        except (ValueError, TypeError):
            num_val = val

        status, needs_review, clean_range = evaluate_source_value(num_val, ref_range)

        test_entry = {
            "test_id": f"t{idx}",
            "name": canonical_name,
            "value": num_val,
            "unit": unit,
            "reference_range": ref_range,
            "status": status,
            "page": 1,
            "needs_review": needs_review,
            "review_reason": "Check OCR value, units and reference range against the original report."
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
        if canonical_name == "Platelet Count" and unit == "/uL" and isinstance(num_val, (int, float)):
            if num_val < 50000 or (num_val < 50 and num_val > 0):
                critical_alerts.append(f"CRITICAL: Severe thrombocytopenia detected (Platelet count: {num_val}). Immediate physician notification recommended.")
        elif canonical_name == "Hemoglobin" and unit == "g/dL" and isinstance(num_val, (int, float)):
            if num_val < 7.0:
                critical_alerts.append(f"CRITICAL: Severe anemia detected (Hemoglobin: {num_val} g/dL). Urgent medical assessment required.")
        elif canonical_name == "Total Leukocyte Count (WBC)" and unit == "/uL" and isinstance(num_val, (int, float)):
            if num_val < 2000 or num_val > 30000:
                critical_alerts.append(f"CRITICAL: Abnormal leukocyte count ({num_val} /uL) outside safety margins.")

        idx += 1

    return tests, validation_flags, critical_alerts, report_date
