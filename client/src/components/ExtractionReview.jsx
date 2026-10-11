import { useCallback, useEffect, useRef, useState } from "react";
import { extractionApi } from "../api/extractions";

export default function ExtractionReview({ report, onExpired, onDirtyChange }) {
  const [data, setData] = useState(null), [rows, setRows] = useState([]), [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), controllers = useRef(new Set()), requestId = useRef(null), dirtyRef = useRef(false), callbacks = useRef({ onExpired, onDirtyChange });
  const loadVersion = useRef(0);
  useEffect(() => { callbacks.current = { onExpired, onDirtyChange }; }, [onExpired, onDirtyChange]);
  const changeDirty = useCallback((value) => { dirtyRef.current = value; setDirty(value); callbacks.current.onDirtyChange?.(value); }, []);
  const reload = useCallback(async (force = false) => {
    const version = ++loadVersion.current;
    const c = new AbortController(); controllers.current.add(c);
    try {
      const next = await extractionApi.read(report.id, c.signal);
      if (!alive.current || c.signal.aborted || version !== loadVersion.current) return;
      if (dirtyRef.current && !force) { setNotice("You have unsaved edits. Reload saved data to reconcile any newer revision."); return; }
      setData(next); setRows(next.review?.rows || []); changeDirty(false);
      if (next.job && !["queued", "running"].includes(next.job.state)) requestId.current = null;
    } catch (err) { if (alive.current && err.name !== "AbortError") { if (err.status === 401) callbacks.current.onExpired(); else setError(err.message); } }
    finally { controllers.current.delete(c); }
  }, [report.id, changeDirty]);
  useEffect(() => {
    alive.current = true; const active = controllers.current;
    const start = setTimeout(() => reload(), 0);
    function warn(event) { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ""; } }
    window.addEventListener("beforeunload", warn);
    return () => { clearTimeout(start); alive.current = false; active.forEach((c) => c.abort()); active.clear(); callbacks.current.onDirtyChange?.(false); window.removeEventListener("beforeunload", warn); };
  }, [reload]);
  useEffect(() => {
    if (!["queued", "running"].includes(data?.job?.state)) return;
    const timer = setInterval(() => reload(), 2000); return () => clearInterval(timer);
  }, [data?.job?.state, reload]);
  async function action(work, message) {
    if (busy) return;
    const c = new AbortController(); controllers.current.add(c); setBusy(true); setError(""); setNotice("");
    try { await work(c.signal); if (alive.current && !c.signal.aborted) { changeDirty(false); await reload(true); setNotice(message); } }
    catch (err) { if (alive.current && err.name !== "AbortError") { if (err.status === 401) callbacks.current.onExpired(); else setError(err.message); } }
    finally { controllers.current.delete(c); if (alive.current) setBusy(false); }
  }
  function edit(id, key, value) { setRows((old) => old.map((row) => row.id === id ? { ...row, [key]: value } : row)); changeDirty(true); setNotice(""); }
  function unknown(row, checked) { setRows((old) => old.map((item) => item.id === row.id ? { ...item, unknown: checked, unreadable: checked ? item.unreadable : false, rawValue: checked ? null : "" } : item)); changeDirty(true); }
  function reset(row) {
    const original = data.result.originalRows.find((item) => item.id === row.id);
    setRows((old) => original ? old.map((item) => item.id === row.id ? { ...original, removed: false } : item) : old.filter((item) => item.id !== row.id)); changeDirty(true);
  }
  const active = ["queued", "running"].includes(data?.job?.state);
  const originals = new Map((data?.result?.originalRows || []).map((row) => [row.id, row]));
  return <section className="extraction-review" aria-labelledby="review-title">
    <h3 id="review-title">Extraction and value review</h3>
    <p>User review means checked by you, not clinically validated. Analysis is not connected.</p>
    {!data && !error && <p role="status">Loading extraction status...</p>}
    {data && !data.available && <p className="demo-banner">Extraction service not connected.</p>}
    {(data?.available === "synthetic-demo" || data?.result?.origin === "synthetic-demo") && <p className="demo-banner">Demo extraction — synthetic sample. These fixture values match only this dedicated sample and are not medical results.</p>}
    {data?.available === "fastapi" && <p>Configured FastAPI extraction. Availability is checked when requested; cancellation is local only.</p>}
    {data?.job && <p role="status">Attempt {data.job.sequence}: {data.job.state}. {data.job.error?.message} {data.job.cancellation === "local-only" && "Provider cancellation is not confirmed."}</p>}
    {active ? <button className="secondary" disabled={busy} onClick={() => action((signal) => extractionApi.cancel(report.id, data.job.id, signal), "Attempt cancelled locally.")}>Cancel extraction</button> : data?.available && <button disabled={busy || dirty} onClick={() => {
      requestId.current ||= crypto.randomUUID();
      action((signal) => extractionApi.start(report.id, requestId.current, data.reviewVersion, signal), "Extraction requested. No percentage progress is estimated.");
    }}>{data.job?.state === "failed" ? "Retry extraction" : data.result ? "Extract again" : "Run extraction"}</button>}
    <button className="secondary" disabled={busy} onClick={() => { if (!dirty || window.confirm("Discard unsaved edits and reload the saved revision?")) { setError(""); reload(true); } }}>Reload saved revision</button>
    {error && <p role="alert" className="error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {data?.result && <>
      <p>Extraction revision {data.result.extractionRevision} · Review version {data.review.version} · <strong>{dirty ? data.review.status === "reviewed" ? "Outdated — unsaved changes" : "Unsaved changes" : data.review.status}</strong></p>
      <p>Original values remain preserved below. Empty units/ranges mean unknown, not zero. No medical range flags are calculated.</p>
      {rows.map((row, index) => {
        const original = originals.get(row.id);
        const changed = original && ["testName", "rawValue", "units", "referenceRange", "reportDate", "sourcePage", "unknown", "unreadable"].some((key) => row[key] !== original[key]);
        return <fieldset key={row.id} className={`review-row ${row.removed ? "removed-row" : ""}`} disabled={busy}>
          <legend>Row {index + 1} · {original ? changed ? "User-corrected" : "Extracted" : "User-entered"}{row.removed ? " · Removed from reviewed result" : ""}</legend>
          {original && <p className="original-value">Original: {original.testName} · value: {original.rawValue ?? "Unknown"} · units: {original.units ?? "Missing"} · reported range: {original.referenceRange ?? "Missing"} · date: {original.reportDate ?? "Missing"} · page: {original.sourcePage ?? "Unknown"}</p>}
          {(row.uncertain || row.unknown || row.unreadable || !row.units) && <p className="hint">Needs your review: {row.reviewReason || "Uncertain, unreadable, unknown, or missing units."}</p>}
          <div className="review-fields">
            <label>Test name<input aria-label={`Test name row ${index + 1}`} value={row.testName} maxLength={160} disabled={row.removed} onChange={(e) => edit(row.id, "testName", e.target.value)} /></label>
            <label>Value (as reported)<input aria-label={`Value row ${index + 1}`} value={row.rawValue ?? ""} maxLength={200} disabled={row.removed || row.unknown || row.unreadable} onChange={(e) => edit(row.id, "rawValue", e.target.value)} /></label>
            <label>Units<input aria-label={`Units row ${index + 1}`} value={row.units ?? ""} maxLength={80} disabled={row.removed} onChange={(e) => edit(row.id, "units", e.target.value || null)} /></label>
            <label>Reported range<input aria-label={`Reported range row ${index + 1}`} value={row.referenceRange ?? ""} maxLength={200} disabled={row.removed} onChange={(e) => edit(row.id, "referenceRange", e.target.value || null)} /></label>
            <label>Date<input aria-label={`Date row ${index + 1}`} type="date" value={row.reportDate ?? ""} disabled={row.removed} onChange={(e) => edit(row.id, "reportDate", e.target.value || null)} /></label>
            <label>Source page<input aria-label={`Source page row ${index + 1}`} type="number" min="1" max="200" value={row.sourcePage ?? ""} disabled={row.removed} onChange={(e) => edit(row.id, "sourcePage", e.target.value ? Number(e.target.value) : null)} /></label>
          </div>
          <label className="checkbox-label"><input type="checkbox" checked={row.unknown} disabled={row.removed} onChange={(e) => unknown(row, e.target.checked)} />Value unknown</label>
          <label className="checkbox-label"><input type="checkbox" checked={row.unreadable} disabled={row.removed} onChange={(e) => { setRows((old) => old.map((item) => item.id === row.id ? { ...item, unreadable: e.target.checked, unknown: e.target.checked || item.unknown, rawValue: e.target.checked ? null : item.rawValue } : item)); changeDirty(true); }} />Value unreadable</label>
          <button type="button" className="secondary" onClick={() => edit(row.id, "removed", !row.removed)}>{row.removed ? "Restore row" : "Remove row"}</button>
          <button type="button" className="secondary" onClick={() => reset(row)}>{original ? "Reset to original" : "Discard added row"}</button>
        </fieldset>;
      })}
      <button className="secondary" disabled={busy || active || rows.length >= 100} onClick={() => { setRows((old) => [...old, { id: crypto.randomUUID(), testName: "", rawValue: null, units: null, referenceRange: null, reportDate: null, sourcePage: null, unknown: true, unreadable: false, removed: false, provenance: "user-entered" }]); changeDirty(true); }}>Add missed row</button>
      <button disabled={busy || !dirty} onClick={() => action((signal) => extractionApi.save(report.id, { resultId: data.result.id, expectedVersion: data.review.version, rows, markReviewed: false }, signal), "Draft saved.")}>Save draft</button>
      <button disabled={busy || active} onClick={() => action((signal) => extractionApi.save(report.id, { resultId: data.result.id, expectedVersion: data.review.version, rows, markReviewed: true }, signal), "Revision reviewed by you. This is not medical approval.")}>Mark reviewed</button>
    </>}
  </section>;
}
