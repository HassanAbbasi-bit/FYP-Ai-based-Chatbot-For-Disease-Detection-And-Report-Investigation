"""De-identified regression fixtures for column-oriented CBC scans."""
import asyncio
import io

from fastapi.testclient import TestClient
from PIL import Image

from app.core.ollama_client import ollama_client
from app.main import app
from app.services import report_parser as parser


TABLE = """DATE : 13/01/2023
LAB NO. : 5
AGE : 21
COMPLETE BLOOD COUNT
TEST RESULT REFERENCE RANGE
Haemoglobin 15 male : 14 - 16 g%
Female : 12 - 14 g%
RBC. Count 5 14 - 169%
PCV 35 35 - 45%
MCV 72.30 80 - 99 fl
MCH 33.05 28 - 32 pg
MCHC 41.67 30 - 34 %
RDW 19 9 - 17 fl
Total WBC Count 9500 4000 - 11000 / cu.mm
Neutrophils 69 40 - 75 %
Lymphocytes 30 20 - 45 %
Eosinophils 0 00 - 08 %
Monocytes 0 00 - 10 %
Basophils 0 00 - 01 %
Platelet Count 1566000 150000 - 450000 / cu.mm
Platelets on Smear Adequate On Smear
RBC Morphology Normocytic, Normochromic
WECs on PS Normal
"""


def test_cbc_rows_do_not_wait_for_model_or_repair_source(monkeypatch):
    async def forbidden():
        raise AssertionError('Clear OCR tables must not invoke the model')
    monkeypatch.setattr(ollama_client, 'check_health', forbidden)
    tests, _, _, date = asyncio.run(parser.extract_structured_tests_ai(TABLE))
    rows = {row['name']: row for row in tests}
    assert len(tests) == 17
    assert date == '13/01/2023'
    assert rows['Platelet Count']['value'] == 1566000
    assert rows['RBC Count']['reference_range'] == '14 - 169'
    assert rows['Hematocrit (PCV)']['reference_range'] == '35 - 45'
    assert rows['RDW-CV']['unit'] == 'fl'
    assert rows['Eosinophils']['value'] == 0
    assert rows['Platelets on Smear']['value'] == 'Adequate On Smear'
    assert rows['WBCs on PS']['value'] == 'Normal'
    assert rows['Hemoglobin']['status'] == 'inconclusive'
    assert 'Female' in rows['Hemoglobin']['reference_range']
    assert all(row['needs_review'] for row in tests)


def test_missing_metadata_and_unusual_numbers_are_not_guessed():
    tests, _, _, _ = asyncio.run(parser.extract_structured_tests_ai('Hemoglobin 172\nRBC. Count 500\nPCV 516\nMCV 832'))
    assert [row['value'] for row in tests] == [172, 500, 516, 832]
    assert all(row['unit'] is None and row['reference_range'] is None for row in tests)
    assert all(row['status'] == 'inconclusive' for row in tests)


def test_ocr_uses_aligned_rows_and_api_returns_valid_date(monkeypatch):
    seen = []
    def ocr(image, config, timeout):
        seen.append((config, timeout))
        assert '--psm 6' in config
        return TABLE
    monkeypatch.setattr(parser.pytesseract, 'image_to_string', ocr)
    image = io.BytesIO()
    Image.new('RGB', (800, 1000), 'white').save(image, format='PNG')
    response = TestClient(app).post('/api/reports/extract',
        headers={'X-Internal-Key': 'synthetic-internal-test-key'},
        files={'file': ('synthetic-cbc.png', image.getvalue(), 'image/png')})
    assert response.status_code == 200
    assert response.json()['report_date'] == '2023-01-13'
    assert len(response.json()['tests']) == 17
    assert len(seen) == 1 and seen[0][1] <= 30


def test_alternate_layout_is_used_when_block_layout_loses_rows(monkeypatch):
    def ocr(image, config, timeout):
        return 'TEST\nHaemoglobin\nRESULT\n15' if '--psm 6' in config else TABLE
    monkeypatch.setattr(parser.pytesseract, 'image_to_string', ocr)
    assert parser.ocr_table_image(Image.new('L', (10, 10))) == TABLE


def test_comparators_and_ambiguous_ranges_are_not_normalized():
    rows = parser.parse_table_rows('Hemoglobin < 7 g/dL 12 - 16')
    assert rows[0]['value'] == '< 7'
    assert parser.evaluate_source_value('< 7', '12 - 16')[0] == 'inconclusive'
    assert parser.evaluate_source_value(13, '1300 - 1700')[0] == 'low'
    assert parser.evaluate_source_value(35, '40 - 0')[0] == 'inconclusive'
