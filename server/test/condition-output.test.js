const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aiGateway } = require('../src/services/ai-gateway');
test('report conditions retain evidence and uncertainty; unknown and mismatched evidence is rejected', async () => {
  const previous = global.fetch;
  const row = { id: 'reviewed-hb', testName: 'Hemoglobin', rawValue: '8.2', units: 'g/dL', referenceRange: '12 - 16', reportDate: null, unknown: false, unreadable: false };
  let supporting = ['Hemoglobin'];
  const gateway = aiGateway({ config: { extractionProvider: 'fastapi', aiServiceUrl: 'http://127.0.0.1:8000' }, connection: { models: { User: { exists: async () => true } } } });
  try {
    global.fetch = async () => new Response(JSON.stringify({ report_id: 'fixture', review_version: 1, origin: 'ollama', model_version: 'fixture', summary: 'Fixture only', findings: [], flags: [{ id: row.id, flag: 'low' }], doctor_discussion_questions: [], disclaimer: 'Fixture only', possible_conditions: [{ condition: 'Synthetic pattern', rationale: 'Fixture low value', supporting_tests: supporting, uncertainty: 'Not confirmed', follow_up: 'Physician review' }] }), { headers: { 'content-type': 'application/json' } });
    const result = await gateway.explain('owner', 'fixture', { version: 1, rows: [row] });
    assert.deepEqual(result.possibleConditions[0].supportingTests, ['Hemoglobin']);
    assert.equal(result.possibleConditions[0].uncertainty, 'Not confirmed');
    assert.equal(result.possibleConditions[0].followUp, 'Physician review');
    supporting = ['Different report'];
    await assert.rejects(gateway.explain('owner', 'fixture', { version: 1, rows: [row] }), e => e.code === 'INVALID_AI_RESPONSE');
    supporting = ['Hemoglobin'];
    await assert.rejects(gateway.explain('owner', 'fixture', { version: 1, rows: [{ ...row, rawValue: null, unknown: true }] }), e => e.code === 'INVALID_AI_RESPONSE');
  } finally { global.fetch = previous; }
});
