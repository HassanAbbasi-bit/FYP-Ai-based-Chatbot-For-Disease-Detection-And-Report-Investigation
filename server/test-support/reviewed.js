const { randomUUID } = require('node:crypto');
const editable = ['id','testName','rawValue','units','referenceRange','reportDate','sourcePage','unknown','unreadable','removed'];
async function reviewed(f,browser) {
 const id=(await browser.request('/api/reports/sample',{method:'POST',body:{requestId:randomUUID()}})).data.report.id;
 const start=await browser.request(`/api/reports/${id}/extraction`,{method:'POST',body:{requestId:randomUUID(),expectedVersion:0}});
 await f.reports.extractions.run(await f.reports.extractions.Job.findById(start.data.job.id));
 let data=(await browser.request(`/api/reports/${id}/extraction`)).data;
 const rows=data.review.rows.map(r=>Object.fromEntries(editable.map(k=>[k,r[k]])));
 await browser.request(`/api/reports/${id}/review`,{method:'PUT',body:{resultId:data.result.id,expectedVersion:data.review.version,rows,markReviewed:true}});
 data=(await browser.request(`/api/reports/${id}/extraction`)).data;
 return {id,data,rows};
}
async function permit(browser) {
 const a=(await browser.request('/api/account')).data;
 return browser.request('/api/account',{method:'PUT',body:{name:a.name,healthContext:a.healthContext,expectedVersion:a.version,consent:{chat:true,reports:true,profile:false,noticeVersion:a.noticeVersion}}});
}
module.exports={reviewed,permit};
