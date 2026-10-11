const {test}=require('node:test'),assert=require('node:assert/strict'),{readConfig}=require('../src/config');
const base={MONGODB_URI:'mongodb://127.0.0.1/synthetic',SESSION_SECRET:'a'.repeat(64),APP_ORIGIN:'https://example.test',NODE_ENV:'production'};
test('production defaults to unavailable chat and rejects synthetic chat/extraction',()=>{assert.equal(readConfig(base).chatProvider,'off');assert.throws(()=>readConfig({...base,CHAT_PROVIDER:'demo'}),/disabled in production/);assert.throws(()=>readConfig({...base,EXTRACTION_DEMO_ENABLED:'true'}),/disabled in production/);});
