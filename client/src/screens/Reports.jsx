import { useEffect, useRef, useState } from "react";
import { reportsApi, formatSize } from "../api/reports";
import ReportDetail from "../components/ReportDetail";
import ReportDeleteDialog from "../components/ReportDeleteDialog";
import { extractionApi } from "../api/extractions";

export default function Reports({ onExpired, loggingOut, onDirtyChange }) {
  const [rows, setRows] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(null);
  const [opening, setOpening] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const alive = useRef(false);
  const uploadId = useRef(null);
  const input = useRef(null);
  const requests = useRef(new Set());
  const uploadController = useRef(null);
  const detailController = useRef(null);
  const listVersion = useRef(0);
  const busy = useRef(false);
  const deleteBusy = useRef(false);
  const expired = useRef(onExpired);
  const reviewDirty = useRef(false), sampleId = useRef(null);
  function guard() { return !reviewDirty.current || window.confirm("Discard unsaved report review edits?"); }
  function dirtyChanged(value) { reviewDirty.current = value; onDirtyChange?.(value); }
  useEffect(() => { expired.current = onExpired; }, [onExpired]);
  function controller() { const c = new AbortController(); requests.current.add(c); return c; }
  function failure(err) {
    if (!alive.current || err.name === "AbortError") return true;
    if (err.status === 401) { expired.current(); return true; }
    return false;
  }
  async function load(nextCursor) {
    const version = ++listVersion.current, c = controller();
    setLoading(true); setError("");
    try {
      const data = await reportsApi.list(nextCursor, c.signal);
      if (!alive.current || c.signal.aborted || version !== listVersion.current) return;
      setRows((old) => {
        const map = new Map((nextCursor ? old : []).map((report) => [report.id, report]));
        data.reports.forEach((report) => map.set(report.id, report));
        return [...map.values()];
      });
      setCursor(data.nextCursor); setLimits(data.limits);
    } catch (err) { if (!failure(err) && version === listVersion.current) setError(err.message); }
    finally { requests.current.delete(c); if (alive.current && version === listVersion.current) setLoading(false); }
  }
  useEffect(() => {
    alive.current = true; let disposed = false;
    queueMicrotask(() => { if (!disposed) load(); });
    const controllers = requests.current;
    return () => { disposed = true; alive.current = false; for (const c of controllers) c.abort(); controllers.clear(); };
    // This screen is remounted on account/navigation changes; requests use refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function open(id) {
    if (!guard()) return;
    detailController.current?.abort();
    const c = controller(); detailController.current = c;
    setSelected(null); setOpening(true); setError("");
    try {
      const data = await reportsApi.detail(id, c.signal);
      if (alive.current && !c.signal.aborted) setSelected(data.report);
    } catch (err) { if (!failure(err) && !c.signal.aborted) setError(err.message); }
    finally { requests.current.delete(c); if (alive.current && !c.signal.aborted) setOpening(false); }
  }
  function choose(event) {
    const next = event.target.files?.[0] || null;
    setFile(next); uploadId.current = next ? crypto.randomUUID() : null;
    setUploadError(""); setNotice("");
  }
  async function upload(event) {
    event.preventDefault();
    if (!file || busy.current || loggingOut || !limits || !guard()) return;
    if (file.size < 1 || file.size > limits.maxBytes) { setUploadError(`Choose a non-empty file no larger than ${formatSize(limits.maxBytes)}.`); return; }
    busy.current = true; setUploading(true); setUploadError(""); setNotice("");
    const c = controller(); uploadController.current = c;
    try {
      const data = await reportsApi.upload(file, uploadId.current, c.signal);
      if (!alive.current || c.signal.aborted) return;
      setNotice("Uploaded — analysis is not connected yet.");
      setFile(null); uploadId.current = null; if (input.current) input.current.value = "";
      await load(); await open(data.report.id);
    } catch (err) {
      if (alive.current && err.name === "AbortError") setUploadError("Upload cancelled. The file is kept selected. Refresh the library before retrying if the result is uncertain.");
      else if (!failure(err)) setUploadError(err.message);
    } finally { requests.current.delete(c); busy.current = false; if (alive.current) setUploading(false); }
  }
  async function remove() {
    if (!selected || deleteBusy.current) return;
    deleteBusy.current = true; setDeleting(true); setDeleteError("");
    const id = selected.id, c = controller();
    try {
      try { await reportsApi.remove(id, c.signal); } catch (err) { if (err.status !== 404) throw err; }
      if (!alive.current) return;
      listVersion.current += 1; setLoading(false);
      detailController.current?.abort(); setSelected(null); setOpening(false); setConfirming(false);
      setRows((old) => old.filter((report) => report.id !== id)); setNotice("Report and private original deleted.");
    } catch (err) { if (!failure(err)) setDeleteError(err.message); }
    finally { requests.current.delete(c); deleteBusy.current = false; if (alive.current) setDeleting(false); }
  }
  async function createSample() {
    if (busy.current || !guard()) return;
    busy.current = true; setUploading(true); setUploadError("");
    sampleId.current ||= crypto.randomUUID(); const c = controller();
    try { const data = await extractionApi.sample(sampleId.current, c.signal); if (alive.current && !c.signal.aborted) { sampleId.current = null; await load(); await open(data.report.id); } }
    catch (err) { if (!failure(err)) setUploadError(err.message); }
    finally { requests.current.delete(c); busy.current = false; if (alive.current) setUploading(false); }
  }
  return <section className="chat-panel history-panel" aria-labelledby="reports-title">
    <h1 id="reports-title">Private report library</h1>
    <p className="intro">Files are saved privately to your account. Uploading does not extract values or provide medical analysis. File checks are not malware scanning.</p>
    <button className="secondary" disabled={uploading || loggingOut} onClick={createSample}>Create synthetic review sample</button>
    <p className="hint">The synthetic sample requires demo mode to be enabled on this server. Its values are available only for this dedicated sample.</p>
    <form onSubmit={upload} className="report-upload">
      <label htmlFor="report-file">Choose a report</label>
      <input ref={input} id="report-file" type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={choose} disabled={uploading || loggingOut} aria-describedby="report-upload-help" />
      <p className="hint" id="report-upload-help">PDF, JPEG, PNG only. {limits ? `Maximum ${formatSize(limits.maxBytes)} per file; ${limits.maxCount} reports and ${formatSize(limits.maxTotalBytes)} per account.` : "Loading upload limits..."} Encrypted PDFs are not supported.</p>
      <button type="submit" disabled={!file || !limits || uploading || loggingOut}>{uploading ? "Uploading and validating..." : uploadError ? "Retry upload" : "Upload report"}</button>
      {uploading && <button type="button" className="secondary" onClick={() => uploadController.current?.abort()}>Cancel upload</button>}
      <p role="status">{uploading ? "Transferring the file, then validating it on the server. No analysis is performed." : notice}</p>
      {uploadError && <p className="error" role="alert">{uploadError}</p>}
    </form>
    <div className="reports-layout">
      <section aria-label="Saved reports">
        <div className="thread-heading"><h2>Saved reports</h2><button className="secondary" onClick={() => load()} disabled={loading || uploading || deleting || loggingOut}>Refresh reports</button></div>
        {loading && <p role="status">Loading reports...</p>}
        {error && <div className="error" role="alert"><p>{error}</p><button className="secondary" onClick={() => load()} disabled={loading}>Retry report list</button></div>}
        {!loading && !rows.length && !error && <p className="empty">No reports yet. Upload a synthetic test file to begin.</p>}
        <ul className="report-list">{rows.map((report) => <li key={report.id}><button className={`history-item ${selected?.id === report.id ? "selected" : ""}`} aria-current={selected?.id === report.id ? "true" : undefined} onClick={() => open(report.id)} disabled={deleting || loggingOut}>
          <span>{report.displayName}</span><small>{report.fileType || "Validation incomplete"} · {formatSize(report.size)} · {new Date(report.createdAt).toLocaleDateString()}</small><small>{report.status === "uploaded" ? "Uploaded — analysis is not connected yet." : report.status === "deleting" ? "Deletion pending" : "Upload incomplete"}</small>
        </button></li>)}</ul>
        {cursor && <button className="secondary" onClick={() => load(cursor)} disabled={loading || deleting || loggingOut}>Load more reports</button>}
      </section>
      <div>{opening ? <p role="status">Opening report...</p> : selected ? <ReportDetail key={selected.id} report={selected} onExpired={onExpired} onDirtyChange={dirtyChanged} onDelete={() => { if (guard()) { setDeleteError(""); setConfirming(true); } }} busy={deleting || loggingOut} /> : <p className="empty">Select a saved report to open its details.</p>}</div>
    </div>
    {confirming && <ReportDeleteDialog busy={deleting} error={deleteError} onClose={() => setConfirming(false)} onConfirm={remove} />}
  </section>;
}
