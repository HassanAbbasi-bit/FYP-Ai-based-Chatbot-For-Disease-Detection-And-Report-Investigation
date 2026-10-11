import { formatSize } from "../api/reports";
import ReportPreview from "./ReportPreview";
export default function ReportDetail({ report, onExpired, onDelete, busy }) {
  return <section className="report-detail" aria-labelledby="report-detail-title">
    <h2 id="report-detail-title">{report.displayName}</h2>
    <p>{report.fileType || "Type awaiting validation"} · {formatSize(report.size)} · {new Date(report.createdAt).toLocaleString()}</p>
    {report.status === "uploaded" ? <>
      <p className="demo-banner">Uploaded — analysis is not connected yet.</p>
      {report.fileType === "application/pdf" ? <p>PDF preview is not embedded. Download the private original to open it in your own viewer. Treat downloaded documents as untrusted.</p> : <ReportPreview key={report.id} report={report} onExpired={onExpired} />}
      <a className="button-link secondary" href={`/api/reports/${report.id}/file?download=1`} download>Download original</a>
    </> : <p role="status">{report.status === "deleting" ? "Deletion is incomplete. Retry Delete to finish removing the file." : "Upload is incomplete. Refresh after cleanup, then retry the selected file."}</p>}
    <button className="danger" disabled={busy} onClick={onDelete}>Delete report</button>
  </section>;
}
