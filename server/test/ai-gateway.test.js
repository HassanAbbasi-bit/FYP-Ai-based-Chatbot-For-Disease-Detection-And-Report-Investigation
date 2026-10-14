const { test } = require("node:test");
const assert = require("node:assert/strict");
const { aiGateway } = require("../src/services/ai-gateway");
const { reviewedRangeFlag, assertReviewedMetadata } = require('../src/services/reviewed-range');
test("configured chat validates structured urgency and sends bounded owner context without profile", async () => {
  const previous = global.fetch; let body;
  global.fetch = async (url, options) => { body = JSON.parse(options.body); assert.equal(url, "http://127.0.0.1:8000/api/chat"); assert.equal(options.headers["X-Internal-Key"], "synthetic-key"); return new Response(JSON.stringify({ reply: "Synthetic answer", suggested_follow_ups: ["Synthetic question"], urgency_level: "emergency", disclaimer: "Synthetic stub only" }), { headers: { "content-type": "application/json" } }); };
  try { const g = aiGateway({ config: { chatProvider: "fastapi", aiServiceUrl: "http://127.0.0.1:8000", aiInternalKey: "synthetic-key" }, connection: { models: { User: { exists: async () => true } } } }); const r = await g.chat({ content: "synthetic", conversationId: "owned", ownerId: "owner", history: [] }); assert.equal(r.structured.urgency, "emergency"); assert.equal(r.mode, "ai"); assert.equal(body.patient_context, undefined); }
  finally { global.fetch = previous; }
});
test("configured chat rejects development fallback and does not fake successful output", async () => {
  const previous = global.fetch; global.fetch = async () => new Response(JSON.stringify({ reply: "fallback", suggested_follow_ups: [], urgency_level: "low", disclaimer: "Development Mode: not connected" }), { headers: { "content-type": "application/json" } });
  try { const g = aiGateway({ config: { chatProvider: "fastapi", aiServiceUrl: "http://127.0.0.1:8000" }, connection: { models: { User: { exists: async () => true } } } }); await assert.rejects(g.chat({ history: [] }), (e) => e.code === "MODEL_UNAVAILABLE"); } finally { global.fetch = previous; }
});
test('reviewed range checks preserve source scales, unknowns and ambiguous ranges', () => {
  const row = {rawValue:'15',referenceRange:'14 - 16',unknown:false,unreadable:false};
  assert.equal(reviewedRangeFlag(row),'normal');
  assert.equal(reviewedRangeFlag({...row,referenceRange:'1400 - 1600'}),'low');
  assert.equal(reviewedRangeFlag({...row,referenceRange:'male: 14 - 16; female: 12 - 14'}),'inconclusive');
  assert.equal(reviewedRangeFlag({...row,rawValue:'< 7'}),'inconclusive');
  assert.equal(reviewedRangeFlag({...row,unknown:true}),'inconclusive');
});
test('invalid report metadata blocks interpretation and chat before any model call',async()=>{
 const original=global.fetch;let calls=0;global.fetch=async()=>{calls++;throw Error('Must not reach the model');};
 const row={testName:'RBC Count',rawValue:'5',units:'%',referenceRange:'14 - 169',unknown:false,unreadable:false};
 const g=aiGateway({config:{},connection:{}});
 try{
  await assert.rejects(g.explain('synthetic','synthetic',{rows:[row],version:2}),e=>e.code==='REVIEW_METADATA_INVALID');
  await assert.rejects(g.chat({reportContext:{rows:[row]}}),e=>e.code==='REVIEW_METADATA_INVALID');
  assert.equal(calls,0);
  assert.doesNotThrow(()=>assertReviewedMetadata([{...row,units:'10^6/uL'}]));
  assert.doesNotThrow(()=>assertReviewedMetadata([{...row,unknown:true,rawValue:null}]));
  assert.throws(()=>assertReviewedMetadata([{...row,testName:'RDW-CV',units:'fL'}]),e=>e.code==='REVIEW_METADATA_INVALID');
 }finally{global.fetch=original;}
});
test('interpretation rejects wrong range flags and findings about absent measurements', async () => {
  const original=global.fetch;
  const rows=[{id:'synthetic-hb',testName:'Hemoglobin',rawValue:'15',units:'g/dL',referenceRange:'14 - 16',reportDate:null,unknown:false,unreadable:false}];
  let flag='low',name='Hemoglobin';
  global.fetch=async()=>new Response(JSON.stringify({report_id:'synthetic-report',review_version:2,origin:'ollama',flags:[{id:rows[0].id,flag}],findings:[{test_name:name,finding:'Fixture',plain_language_explanation:'Fixture'}],summary:'Fixture',doctor_discussion_questions:[],disclaimer:'Fixture'}),{headers:{'content-type':'application/json'}});
  const g=aiGateway({config:{extractionProvider:'fastapi',aiServiceUrl:'http://127.0.0.1:8000'},connection:{models:{User:{exists:async()=>true}}}});
  try{
    await assert.rejects(g.explain('synthetic-owner','synthetic-report',{version:2,rows}),e=>e.code==='INVALID_AI_RESPONSE');
    flag='normal';name='Absent test';
    await assert.rejects(g.explain('synthetic-owner','synthetic-report',{version:2,rows}),e=>e.code==='INVALID_AI_RESPONSE');
    name='Hemoglobin';assert.equal((await g.explain('synthetic-owner','synthetic-report',{version:2,rows})).rows[0].rawValue,'15');
  }finally{global.fetch=original;}
});
