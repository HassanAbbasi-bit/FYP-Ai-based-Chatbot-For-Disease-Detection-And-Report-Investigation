import json
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.core.ollama_client import ollama_client
from app.api.routes.reviewed import ReviewedRow, reviewed_flag
client = TestClient(app)
headers = {'X-Internal-Key': 'synthetic-internal-test-key'}
row = dict(id='synthetic-row',testName='Synthetic measurement',rawValue='12.5',units='fixture-unit',referenceRange='10 - 20',unknown=False,unreadable=False)
payload = dict(report_id='synthetic-owned-id',review_version=3,rows=[row])
def test_strict_internal_auth():
    for h in [{}, {'X-Internal-Key':'dev'}, {'X-Internal-Key':'wrong'}]:
        assert client.post('/api/reports/reviewed/explain',headers=h,json=payload).status_code == 401
@pytest.mark.parametrize('value,range_,expected', [('12.5','10 - 20','normal'),('8','10 - 20','low'),('23','10 - 20','high'),('<5','10 - 20','inconclusive'),('negative','10 - 20','inconclusive'),('12','20 - 10','inconclusive'),('12',None,'inconclusive'),('12','1300 - 1700','low')])
def test_reviewed_range_is_never_rescaled(value, range_, expected):
    assert reviewed_flag(ReviewedRow(**dict(row,rawValue=value,referenceRange=range_)))==expected

def test_reviewed_explanation_uses_corrected_revision_and_no_cached_report(monkeypatch):
    seen={}
    async def generate(**kwargs):
        seen.update(kwargs)
        return json.dumps(dict(summary='Synthetic interpretation',findings=[dict(test_name='Synthetic measurement',finding='Synthetic finding',plain_language_explanation='Fixture only')],doctor_discussion_questions=['Synthetic question']))
    monkeypatch.setattr(ollama_client,'generate_response',generate)
    r=client.post('/api/reports/reviewed/explain',headers=headers,json=payload)
    assert r.status_code==200
    assert r.json()['review_version']==3
    assert r.json()['flags']==[dict(id='synthetic-row',flag='normal')]
    assert '12.5' in seen['prompt']
    assert r.json()['origin']=='ollama'

def test_model_failure_has_no_fabricated_results(monkeypatch):
    async def fail(**kwargs): raise ConnectionError('Synthetic unavailable')
    monkeypatch.setattr(ollama_client,'generate_response',fail)
    assert client.post('/api/reports/reviewed/explain',headers=headers,json=payload).status_code==503
    assert client.post('/api/symptoms/assess',headers=headers,json={'symptoms':['synthetic concern']}).status_code==503

def test_report_chat_receives_saved_rows_and_actual_question(monkeypatch):
    seen=[]
    async def health(): return {'connected':True}
    async def chat(messages,**kwargs): seen.extend(messages); return 'Synthetic report answer'
    monkeypatch.setattr(ollama_client,'check_health',health)
    monkeypatch.setattr(ollama_client,'chat_conversation',chat)
    r=client.post('/api/reports/reviewed/chat',headers=headers,json=dict(payload,message='Synthetic question',conversation_id='synthetic-conversation',history=[]))
    assert r.status_code==200
    assert any('12.5' in m['content'] for m in seen)
    assert seen[-1]['content']=='Synthetic question'

def test_small_tables_survive_offline_model_and_platelets_are_not_admin_text():
    import asyncio
    from app.services.report_parser import extract_structured_tests_ai
    for text, expected in [('Hemoglobin 12.5 g/dL 10 - 20', 1), ('Hemoglobin 12.5 g/dL 10 - 20\nWBC 6000 /uL 4000 - 11000\nPlatelets 250000 /uL 150000 - 410000\nMCV 90 fL 80 - 100', 4)]:
        tests, _, _, date = asyncio.run(extract_structured_tests_ai(text))
        assert len(tests) == expected
        assert date is None

def test_context_allocation_fits_small_reports_and_rejects_oversized_text():
    from app.api.routes.reviewed import report_context_tokens
    from fastapi import HTTPException
    assert report_context_tokens('Synthetic small CBC', 1800) == 4096
    text = 'μ' * 4000
    assert report_context_tokens(text, 500) >= len(text.encode('utf-8')) + 500 + 256
    with pytest.raises(HTTPException) as e:
        report_context_tokens('x' * 33000, 500)
    assert e.value.status_code == 413

def test_valid_json_with_wrong_types_is_not_reported_as_model_offline(monkeypatch):
    async def generate(**kwargs): return json.dumps({'summary':'Synthetic summary','findings':[{'test_name':'Synthetic measurement','finding':None,'plain_language_explanation':'Fixture'}],'doctor_discussion_questions':[]})
    monkeypatch.setattr(ollama_client,'generate_response',generate)
    r=client.post('/api/reports/reviewed/explain',headers=headers,json=payload)
    assert r.status_code==502
    assert r.json()['detail']['code']=='INVALID_MODEL_OUTPUT'

def test_model_timeout_has_its_own_error_code(monkeypatch):
    async def generate(**kwargs): raise TimeoutError('Synthetic timeout')
    monkeypatch.setattr(ollama_client,'generate_response',generate)
    r=client.post('/api/reports/reviewed/explain',headers=headers,json=payload)
    assert r.status_code==504
    assert r.json()['detail']['code']=='MODEL_TIMEOUT'

def test_condition_suggestions_are_grounded_in_abnormal_reviewed_tests(monkeypatch):
    seen = {}
    async def generate(**kwargs):
        seen.update(kwargs)
        return json.dumps(dict(summary='Fixture', findings=[], doctor_discussion_questions=['Fixture question'], possible_conditions=[dict(condition='Synthetic pattern', rationale='Fixture low value', supporting_tests=['Synthetic measurement'], uncertainty='Further assessment needed', follow_up='Discuss confirmation with a physician')]))
    monkeypatch.setattr(ollama_client,'generate_response',generate)
    abnormal = dict(payload, rows=[dict(row, rawValue='8')])
    r = client.post('/api/reports/reviewed/explain',headers=headers,json=abnormal)
    assert r.status_code == 200
    assert r.json()['possible_conditions'][0]['supporting_tests'] == ['Synthetic measurement']
    assert 'physician confirmation' in seen['system_prompt']
    # A normal or unknown measurement cannot support the same suggestion.
    assert client.post('/api/reports/reviewed/explain',headers=headers,json=payload).status_code == 502
    unknown = dict(payload, rows=[dict(row, rawValue=None, unknown=True)])
    assert client.post('/api/reports/reviewed/explain',headers=headers,json=unknown).status_code == 502

def test_normal_report_requests_no_disease_suggestions_and_does_not_claim_health(monkeypatch):
    seen = {}
    async def generate(**kwargs):
        seen.update(kwargs)
        return json.dumps(dict(summary='Fixture', findings=[], doctor_discussion_questions=[], possible_conditions=[]))
    monkeypatch.setattr(ollama_client,'generate_response',generate)
    r = client.post('/api/reports/reviewed/explain',headers=headers,json=payload)
    assert r.status_code == 200
    assert r.json()['possible_conditions'] == []
    assert seen['response_schema']['properties']['possible_conditions']['maxItems'] == 0

def test_symptoms_keep_missing_severity_unknown_and_reject_definitive_model_classification(monkeypatch):
    seen = {}
    async def health(): return {'connected':True}
    async def generate(**kwargs):
        seen.update(kwargs)
        return json.dumps(dict(possible_causes=[dict(condition='Fixture',likelihood='confirmed',rationale='Fixture')],recommended_questions_for_doctor=['Fixture'],self_care_notes='Fixture'))
    monkeypatch.setattr(ollama_client,'check_health',health)
    monkeypatch.setattr(ollama_client,'generate_response',generate)
    r = client.post('/api/symptoms/assess',headers=headers,json={'symptoms':['synthetic concern']})
    assert r.status_code == 502
    assert 'Severity: unspecified' in seen['prompt']
    assert seen['response_schema']['$defs']['SymptomCause']['properties']['likelihood']['const'] == 'possible'

def test_emergency_in_symptom_notes_bypasses_model(monkeypatch):
    async def generate(**kwargs): raise AssertionError('Emergency must not wait for inference')
    monkeypatch.setattr(ollama_client,'generate_response',generate)
    r = client.post('/api/symptoms/assess',headers=headers,json={'symptoms':['fatigue'],'additional_notes':'severe chest pain'})
    assert r.status_code == 200
    assert r.json()['is_red_flag'] is True
    assert r.json()['origin'] == 'rules'
