const express = require('express');
const { csrfSynchronisedProtection, limiter } = require('../middleware/security');
const { ReportError } = require('../services/report-errors');
const { fail } = require('../middleware/errors');
const id = /^[a-f\d]{24}$/i, uuid = /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function analysisRoutes(reports) {
 const router = express.Router(); if (!reports?.analyses) return router;
 const only = (b, keys) => b && !Array.isArray(b) && typeof b === 'object' && Object.keys(b).every(k => keys.includes(k));
 router.use(limiter(60,60000, req => String(req.user._id)));
 router.use((req,res,next) => ['GET','HEAD'].includes(req.method) ? next() : csrfSynchronisedProtection(req,res,next));
 router.param('reportId',(req,res,next,value) => { if (!id.test(value)) return fail(res,404,'NOT_FOUND','Report not found.'); req.scope = { _id: value, ownerId: req.user._id }; next(); });
 router.get('/:reportId/analyses',async(req,res) => res.json(await reports.analyses.read(req.scope)));
 router.post('/:reportId/analyses',limiter(10,60000,req=>String(req.user._id)),async(req,res) => {
   if (!only(req.body,['requestId','reviewVersion']) || !uuid.test(req.body.requestId || '') || !Number.isInteger(req.body.reviewVersion) || req.body.reviewVersion < 1) throw new ReportError(400,'INVALID_INPUT','Provide a UUID v4 requestId and saved reviewVersion.');
   res.status(202).json({ analysis: await reports.analyses.start(req.scope,req.body.requestId.toLowerCase(),req.body.reviewVersion) });
 });
 router.post('/:reportId/analyses/:analysisId/cancel',async(req,res)=> { if (!id.test(req.params.analysisId) || !only(req.body,[]) || Object.keys(req.body).length) throw new ReportError(400,'INVALID_INPUT','Invalid cancellation.'); await reports.analyses.cancel(req.scope,req.params.analysisId); res.json({ cancelled:true }); });
 router.use((e,req,res,next)=>e instanceof ReportError ? fail(res,e.status,e.code,e.message) : next(e)); return router;
}
module.exports = { analysisRoutes };
