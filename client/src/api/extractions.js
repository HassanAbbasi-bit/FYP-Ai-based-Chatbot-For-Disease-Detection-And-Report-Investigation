import { api } from "./client.js";
const fields = ["id", "testName", "rawValue", "units", "referenceRange", "reportDate", "sourcePage", "unknown", "unreadable", "removed"];
export function editableRows(rows) { return rows.map((row) => Object.fromEntries(fields.map((key) => [key, row[key]]))); }
export const extractionApi = {
  read: (id, signal) => api(`/reports/${id}/extraction`, { signal }),
  start: (id, requestId, expectedVersion, signal) => api(`/reports/${id}/extraction`, { method: "POST", body: { requestId, expectedVersion }, signal }),
  sample: (requestId, signal) => api("/reports/sample", { method: "POST", body: { requestId }, signal }),
  cancel: (id, jobId, signal) => api(`/reports/${id}/extraction/${jobId}/cancel`, { method: "POST", signal }),
  save: (id, data, signal) => api(`/reports/${id}/review`, { method: "PUT", body: { ...data, rows: editableRows(data.rows) }, signal }),
};
