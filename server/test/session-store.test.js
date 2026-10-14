const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSessionTouch } = require('../src/services/session-store');
const { errorHandler } = require('../src/middleware/errors');

test('only the exact missing-session refresh is a no-op; other storage errors propagate unchanged', () => {
  for (const error of [null, new Error('Unable to find the session to touch'), Object.assign(new Error('Fixture network error'), { name: 'MongoNetworkError' }), Object.assign(new Error('Unable to find the session to touch'), { code: 13 }), new Error('Different storage failure')]) {
    let writes = 0;
    const store = { touch(id, session, callback) { callback(error); }, set() { writes++; } };
    normalizeSessionTouch(store);
    const method = store.touch;
    normalizeSessionTouch(store);
    assert.equal(store.touch, method);
    store.touch('synthetic-id', {}, actual => assert.equal(actual, error?.message === 'Unable to find the session to touch' && error.code === undefined ? null : error));
    assert.equal(writes, 0);
  }
});

test('unexpected completion logs show a safe category while still closing an incomplete response', () => {
  const logs = [], original = console.error;
  const secret = 'mongodb://fixture:do-not-log@private-host/db';
  let destroyed = false;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    const handler = errorHandler({ readyState: 1 });
    handler(Object.assign(new Error(secret), { name: 'MongoNetworkError' }), { originalUrl: '/api/reports/private-id?patient=private' }, { headersSent: true, writableEnded: false, destroy() { destroyed = true; } }, () => {});
    assert.equal(destroyed, true);
    assert.match(logs[0], /DATABASE_NETWORK/);
    assert.ok(!logs[0].includes(secret));
    assert.ok(!logs[0].includes('private-id'));
    handler(Object.assign(new Error(secret), { code: 'EPIPE' }), {}, { headersSent: true, writableEnded: true, destroy() { assert.fail('Completed response must not be destroyed'); } }, () => {});
    assert.match(logs[1], /CONNECTION_CLOSED/);
  } finally { console.error = original; }
});
