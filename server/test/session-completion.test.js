const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isolatedServer, client } = require('../test-support/database');
const { upload, syntheticReports } = require('../test-support/reports');

test('a report status request completing across re-login does not log failure or restore the revoked session', async () => {
  let fixture, release, pending;
  const logs = [], originalLog = console.error;
  try {
    fixture = await isolatedServer();
    const a = client(fixture);
    await a.bootstrap();
    const credentials = { email: 'report-session@synthetic.test', password: 'Synthetic-password-123' };
    assert.equal((await a.request('/api/auth/register', { method: 'POST', body: { name: 'Report Session Fixture', ...credentials } })).status, 201);
    const uploaded = await upload(fixture, a, (await syntheticReports()).png);
    assert.equal(uploaded.status, 201);
    const id = uploaded.data.report.id, oldCookie = a.cookie;
    const oldId = decodeURIComponent(oldCookie.slice(oldCookie.indexOf('=') + 1)).slice(2).split('.')[0];
    const read = fixture.reports.extractions.read.bind(fixture.reports.extractions);
    let arrived;
    const started = new Promise(resolve => arrived = resolve);
    const gate = new Promise(resolve => release = resolve);
    fixture.reports.extractions.read = async (...args) => { arrived(); await gate; return read(...args); };
    console.error = (...args) => logs.push(args);
    pending = a.request(`/api/reports/${id}/extraction`);
    await started;
    assert.equal((await a.request('/api/auth/login', { method: 'POST', body: credentials })).status, 200);
    release();
    assert.equal((await pending).status, 200);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(logs.filter(args => args[0] === 'REQUEST_COMPLETION_FAILED').length, 0);
    assert.equal(await fixture.connection.db.collection('sessions').countDocuments({ _id: oldId }), 0);
    assert.equal((await a.request('/api/auth/me', { savedCookie: oldCookie })).status, 401);
    assert.equal((await a.request('/api/auth/me')).status, 200);
  } finally {
    release?.(); await pending?.catch(() => {});
    console.error = originalLog;
    await fixture?.close();
  }
});
