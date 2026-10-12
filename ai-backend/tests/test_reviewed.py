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
