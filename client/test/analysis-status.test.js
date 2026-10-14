import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analysisFailure,analysisProgress} from '../src/api/analysis-status.js';
test('interrupted and invalid model attempts explain that no result was saved',()=>{
 assert.match(analysisFailure('INTERRUPTED'),/interrupted.*No interpretation was saved/);
 assert.match(analysisFailure('INVALID_MODEL_OUTPUT'),/AI backend needs investigation/);
});
test('running work identifies the actual reviewed input and a passed deadline is not a success',()=>{
 const job={state:'running',providerStartedAt:'2026-10-14T10:00:00Z',deadlineAt:'2026-10-14T10:08:00Z',inputRowCount:17,reviewVersion:2};
 assert.match(analysisProgress(job,Date.parse('2026-10-14T10:05:00Z')),/17 reviewed entries from revision 2.*5m 0s/);
 assert.match(analysisProgress(job,Date.parse('2026-10-14T10:09:00Z')),/deadline has passed.*no automatic retry/);
 assert.match(analysisProgress({...job,state:'queued'}),/Waiting for an available processing slot/);
});
