// Explicit live smoke check: disposable MongoDB + generated synthetic report.
// Never loads the user's MongoDB URI or uses their account records.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {isolatedServer,client}=require('../test-support/database');
const {upload}=require('../test-support/reports');
const {permit}=require('../test-support/reviewed');
const {editable}=require('../src/services/extraction-data');
const dotenv=require('dotenv');
const assert=require('node:assert/strict');
(async()=>{
 const ai=dotenv.parse(fs.readFileSync(path.resolve(__dirname,'../../ai-backend/.env')));
 let f;let r;
 let lastPass='startup';
 const originalLog=console.log;console.log=(...values)=>{if(String(values[0]).startsWith('PASS '))lastPass=values[0];originalLog(...values);fs.writeFileSync(path.resolve(__dirname,'../.test-runtime/live-ai-progress.json'),JSON.stringify({lastPass,time:new Date().toISOString()}));};
 const requestId=()=>randomUUID();
 const wait=async(read,kind)=>{const deadline=Date.now()+600000;while(Date.now()<deadline){let r;try{r=await read();}catch(error){if(!['ECONNRESET','UND_ERR_SOCKET'].includes(error.cause?.code))throw error;console.log('RETRY '+kind+' disconnected status read; inference not resubmitted');await new Promise(r=>setTimeout(r,3000));continue;}if([429,503].includes(r.status)){console.log('RETRY '+kind+' status read HTTP '+r.status+'; inference not resubmitted');await new Promise(r=>setTimeout(r,3000));continue;}assert.equal(r.status,200,kind+' status request failed HTTP '+r.status+' '+(r.data.error?.code||''));const job=kind==='extraction'?r.data.job:r.data.analyses[0];if(job&&!['queued','running'].includes(job.state)){assert.equal(job.state,'succeeded',kind+' failed: '+(job.errorCode||job.error?.code||'unknown'));return r.data;}await new Promise(r=>setTimeout(r,2000));}throw Error(kind+' did not finish');};
 try{
  f=await isolatedServer({extractionAutoRun:true,databaseTimeoutMs:10000,reportConfig:{chatProvider:'fastapi',extractionProvider:'fastapi',aiServiceUrl:'http://127.0.0.1:8000',aiInternalKey:ai.INTERNAL_API_KEY}});
  const a=client(f);await a.bootstrap();assert.equal((await a.request('/api/auth/register',{method:'POST',body:{name:'Synthetic Live Check',email:`live-${randomUUID()}@synthetic.test`,password:'Synthetic-password-123'}})).status,201);await permit(a);
  const health=await a.request('/api/account/ai-status');assert.equal(health.data.modelReady,true);assert.equal(health.data.ocrReady,true);console.log('PASS live model/OCR readiness through Express');
  if(!process.argv.includes('--report-only')){
  const conversation=(await a.request('/api/conversations',{method:'POST',body:{}})).data.conversation;
  r=await a.request(`/api/conversations/${conversation.id}/messages`,{method:'POST',body:{requestId:requestId(),message:'Explain what Blood CP means in two sentences.'}});assert.equal(r.status,200,'Live general chat failed: '+r.data.error?.code);assert.equal(r.data.messages[1].mode,'ai');console.log('PASS live general model chat');
  r=await a.request('/api/symptoms',{method:'POST',body:{symptoms:['Mild fatigue'],duration:'one day',severity:'mild',additional_notes:'Synthetic software check; no patient data.'}});assert.equal(r.status,200,'Live symptoms failed: '+r.data.error?.code);assert.equal(r.data.origin,'ollama');console.log('PASS live symptom assessment');
  }
  const bytes=fs.readFileSync(path.resolve(__dirname,'../.test-runtime/synthetic-blood-cp.png'));
  r=await upload(f,a,bytes,{name:'synthetic-live-blood-cp.png'});assert.equal(r.status,201);const id=r.data.report.id;
  r=await a.request(`/api/reports/${id}/extraction`,{method:'POST',body:{requestId:requestId(),expectedVersion:0}});assert.equal(r.status,202);
  let data=await wait(()=>a.request(`/api/reports/${id}/extraction`),'extraction');assert.ok(data.review.rows.length>=4);const original=data.review.rows[0].rawValue;
  const rows=data.review.rows.map(row=>Object.fromEntries(editable.map(k=>[k,row[k]])));rows[0].rawValue='13.0';
  r=await a.request(`/api/reports/${id}/review`,{method:'PUT',body:{resultId:data.result.id,expectedVersion:data.review.version,rows,markReviewed:true}});assert.equal(r.status,200);
  data=(await a.request(`/api/reports/${id}/extraction`)).data;assert.equal(data.result.originalRows[0].rawValue,original);console.log('PASS actual image upload, OCR, correction and immutable original');
  r=await a.request(`/api/reports/${id}/analyses`,{method:'POST',body:{requestId:requestId(),reviewVersion:data.review.version}});assert.equal(r.status,202);
  const result=(await wait(()=>a.request(`/api/reports/${id}/analyses`),'analysis')).analyses[0];assert.equal(result.origin,'fastapi');assert.equal(result.modelVersion,'llama3.2:3b');assert.equal(result.output.rows[0].rawValue,'13.0');assert.ok(result.output.summary);console.log('PASS actual model interpretation of reviewed corrections');
  const reportChat=(await a.request('/api/conversations',{method:'POST',body:{reportId:id,reviewVersion:data.review.version}})).data.conversation;
  r=await a.request(`/api/conversations/${reportChat.id}/messages`,{method:'POST',body:{requestId:requestId(),message:'List the test names and values in my reviewed report. Keep it brief.'}});assert.equal(r.status,200,'Live report chat failed: '+r.data.error?.code);assert.equal(r.data.messages[1].mode,'ai');assert.match(r.data.messages[1].content,/hemoglobin/i);assert.match(r.data.messages[1].content,/13(?:\.0)?/);console.log('PASS live report-specific model conversation');
  console.log('Live integrated smoke checks passed. All records were synthetic and the test database is removed.');
 }finally{try{await f?.close();}catch(cleanupError){console.error('Temporary test cleanup failed:',cleanupError.name);}} 
})().catch(error=>{console.error('Live integrated smoke check failed:', error instanceof assert.AssertionError || /^(analysis|extraction) did not finish$/.test(error.message) ? error.message.split('\n')[0] : [error.name,error.code,error.cause?.code].filter(Boolean).join(' '));process.exitCode=1;});
