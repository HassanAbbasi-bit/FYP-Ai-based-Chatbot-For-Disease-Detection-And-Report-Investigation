import re
from pathlib import Path
from typing import List, Dict, Any, Tuple
import fitz  # PyMuPDF
from PIL import Image
import pytesseract

from app.config import settings
from app.core.security import sanitize_medical_text
from app.services.range_checker import evaluate_lab_value

if Path(settings.TESSERACT_CMD).exists():
    pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD

# Known standard medical laboratory tests and typical units
COMMON_LAB_PATTERNS = [
    ("Hemoglobin", r"(?:Hemoglobin|HGB|Hb)\s*[:=\s]\s*([0-9.]+)\s*(g/dL|g/L)?", "g/dL", "13.5 - 17.5"),
    ("White Blood Cell Count (WBC)", r"(?:WBC|White\s+Blood\s+Cells?)\s*[:=\s]\s*([0-9.]+)\s*(10\^3/uL|/uL|K/uL)?", "10^3/uL", "4.5 - 11.0"),
    ("Platelet Count", r"(?:Platelets?|PLT)\s*[:=\s]\s*([0-9.]+)\s*(10\^3/uL|/uL|K/uL)?", "10^3/uL", "150 - 450"),
    ("Red Blood Cell Count (RBC)", r"(?:RBC|Red\s+Blood\s+Cells?)\s*[:=\s]\s*([0-9.]+)\s*(10\^6/uL|M/uL)?", "10^6/uL", "4.3 - 5.9"),
    ("Fasting Blood Glucose", r"(?:Glucose|Blood\s+Sugar|FBS)\s*[:=\s]\s*([0-9.]+)\s*(mg/dL|mmol/L)?", "mg/dL", "70 - 99"),
    ("Serum Creatinine", r"(?:Creatinine)\s*[:=\s]\s*([0-9.]+)\s*(mg/dL|umol/L)?", "mg/dL", "0.7 - 1.3"),
    ("Serum Ferritin", r"(?:Ferritin)\s*[:=\s]\s*([0-9.]+)\s*(ng/mL|ug/L)?", "ng/mL", "20.0 - 250.0"),
    ("Total Cholesterol", r"(?:Total\s+Cholesterol|Cholesterol)\s*[:=\s]\s*([0-9.]+)\s*(mg/dL|mmol/L)?", "mg/dL", "< 200"),
]

def extract_text_from_pdf_or_image(file_path: Path) -> Tuple[str, List[int]]:
    """
    Extracts text from PDF using PyMuPDF. If pages have no digital text,
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
            
            # If digital text exists, use it
            if len(page_text.strip()) > 30:
                extracted_text += f"\n--- Page {page_idx + 1} ---\n" + page_text
                pages_processed.append(page_idx + 1)
            else:
                # Scanned page fallback to OCR
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
            extracted_text = "[Image OCR Unprocessed - Tesseract not configured]"

    return sanitize_medical_text(extracted_text), pages_processed

def extract_structured_tests(raw_text: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, str]]]:
    """
    Extracts structured lab tests, applies range checks,
    and returns validation flags for missing units or questionable values.
    """
    tests = []
    validation_flags = []
    
    idx = 1
    for test_name, pattern, default_unit, default_range in COMMON_LAB_PATTERNS:
        match = re.search(pattern, raw_text, re.IGNORECASE)
        if match:
            value_str = match.group(1)
            unit_found = match.group(2) if len(match.groups()) >= 2 and match.group(2) else default_unit
            
            status, needs_review = evaluate_lab_value(value_str, default_range)
            
            test_item = {
                "test_id": f"t{idx}",
                "name": test_name,
                "value": float(value_str) if value_str.replace('.', '', 1).isdigit() else value_str,
                "unit": unit_found,
                "reference_range": default_range,
                "status": status,
                "page": 1,
                "needs_review": needs_review,
                "review_reason": "Value outside standard bounds" if status in ["low", "high"] else None
            }
            tests.append(test_item)
            
            if not match.group(2):
                validation_flags.append({
                    "test_name": test_name,
                    "issue": "missing_unit",
                    "message": f"Unit omitted in document; defaulted to standard {default_unit}."
                })
            idx += 1

    return tests, validation_flags
