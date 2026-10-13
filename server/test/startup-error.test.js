const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startupError } = require('../src/services/startup-error');
test('startup separates nested Atlas TLS, authentication, DNS and selection errors without leaking driver text', () => {
  const secret = 'mongodb://synthetic-user:do-not-print@synthetic.invalid/private';
  const member = detail => ({ name: 'MongooseServerSelectionError', message: secret, reason: { servers: new Map([['private-host', { error: { message: secret, ...detail } }]]) } });
  for (const [error, expected] of [
    [member({ cause: { code: 'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR', message: secret } }), /TLS connection/],
    [member({ code: 18 }), /authentication failed/],
    [member({ cause: { code: 'ENOTFOUND' } }), /DNS lookup failed/],
    [member({}), /connection timed out/],
    [{ message: secret }, /initialization failed/],
  ]) {
    const message = startupError(error, 'database', 5000);
    assert.match(message, expected);
    assert.ok(!message.includes(secret));
    assert.ok(!message.includes('private-host'));
  }
});
test('startup retains actionable port, storage and replica-set failures', () => {
  assert.match(startupError({ code: 'EADDRINUSE' }, 'http', 5000), /Port 5000 is already in use/);
  assert.match(startupError({ code: 'STORAGE_UNAVAILABLE' }, 'database', 5000), /stop duplicate servers/);
  assert.match(startupError({ code: 'REPLICA_SET_REQUIRED', message: 'private text' }, 'database', 5000), /replica-set transactions/);
});
