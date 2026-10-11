const { ReportError } = require("./report-errors");
const NOTICE_VERSION = "fyp-ai-v1";
async function accountFence(connection, ownerId, session) {
  const result = await connection.models.User.updateOne({ _id: ownerId, deletionState: { $ne: "pending" } }, { $inc: { contextFence: 1 } }, { session });
  if (!result.modifiedCount) throw new ReportError(401, "UNAUTHENTICATED", "Your account is unavailable.");
}
async function assertConsent(connection, ownerId, kind, session) {
  const filter = { _id: ownerId, deletionState: { $ne: "pending" }, "consent.noticeVersion": NOTICE_VERSION, [`consent.${kind}`]: true };
  if (session) { const r = await connection.models.User.updateOne(filter, { $inc: { contextFence: 1 } }, { session }); if (r.modifiedCount) return; }
  else if (await connection.models.User.exists(filter)) return;
  throw new ReportError(403, "CONSENT_REQUIRED", "Enable the current AI processing consent in Settings before sending this data. Withdrawing consent stops new transfers, not data already sent.");
}
module.exports = { NOTICE_VERSION, assertConsent, accountFence };
