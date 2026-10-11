const { reportModel } = require('../models/Report');
const { extractionModels } = require('../models/Extraction');
const { ReportError, reportNotFound } = require('./report-errors');
async function reportContext(connection, ownerId, reportId, version, session, fence = false) {
 const Report = reportModel(connection);
 const report = await Report.findOne({ _id: reportId, ownerId, status: 'uploaded' }).select('+sampleVersion').session(session);
 if (!report) throw reportNotFound();
 const review = await extractionModels(connection).ReportReview.findOne({ ownerId, reportId, version }).session(session).lean();
 if (!review || review.status !== 'reviewed') throw new ReportError(409,'REVIEW_REQUIRED','Choose a saved user-reviewed revision.');
 const outdated = report.reviewVersion !== version || String(report.currentResultId) !== String(review.resultId);
 if (fence) { if (outdated) throw new ReportError(409,'REPORT_CONTEXT_OUTDATED','This report has changed. Open a conversation for its latest reviewed revision.'); report.analysisFence += 1; await report.save({ session }); }
 return { report, review, outdated };
}
module.exports = { reportContext };
