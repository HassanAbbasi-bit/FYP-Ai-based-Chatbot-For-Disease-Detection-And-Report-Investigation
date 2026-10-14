// Compare only exact reviewed numbers and printed bounds. This is not a diagnosis.
function reviewedRangeFlag(row) {
  if (row.unknown || row.unreadable || !row.rawValue || !row.referenceRange) return 'inconclusive';
  const number = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  if (!new RegExp(`^${number}$`).test(row.rawValue.trim())) return 'inconclusive';
  const match = new RegExp(`^\\s*(${number})\\s*(?:-|\u2013|to)\\s*(${number})\\s*$`).exec(row.referenceRange);
  const value = Number(row.rawValue);
  if (!match || !Number.isFinite(value)) return 'inconclusive';
  const low = Number(match[1]), high = Number(match[2]);
  if (!Number.isFinite(low) || !Number.isFinite(high) || low > high) return 'inconclusive';
  return value < low ? 'low' : value > high ? 'high' : 'normal';
}
function assertReviewedMetadata(rows) {
  const {ReportError}=require('./report-errors');
  for (const row of rows) {
    if (row.removed || row.unknown || row.unreadable) continue;
    const name=row.testName.toLowerCase(), unit=(row.units||'').toLowerCase().replace(/\s/g,'');
    let issue;
    if (/\brbc\.?\s*count\b|red blood cell count/.test(name) && /^(%|g%|g\/dl|g\/l|fl|pg)$/.test(unit)) issue='RBC Count has a unit that does not measure a red-cell count.';
    if (/\brdw[\s-]*cv\b/.test(name) && /^(fl|pg|g\/dl)$/.test(unit)) issue='RDW-CV has an incompatible unit. Verify whether the report actually names RDW-CV or another RDW measurement.';
    if (issue) throw new ReportError(409,'REVIEW_METADATA_INVALID',`${issue} Return to Review extracted values and verify the test name, unit and range with the laboratory source. If they cannot be verified, mark the entry unknown or unreadable. No values or ranges were corrected automatically.`);
  }
}
module.exports = { reviewedRangeFlag, assertReviewedMetadata };
