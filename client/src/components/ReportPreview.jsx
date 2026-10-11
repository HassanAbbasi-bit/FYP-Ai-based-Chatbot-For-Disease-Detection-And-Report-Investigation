import { useEffect, useState } from "react";
import { reportFile } from "../api/client";
export default function ReportPreview({ report, onExpired }) {
  const [preview, setPreview] = useState({ url: "", error: "", loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let url = "";
    async function load() {
      try {
        const blob = await reportFile(report.id, controller.signal);
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({ url, error: "", loading: false });
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error.status === 401) onExpired();
        else setPreview({ url: "", error: error.message, loading: false });
      }
    }
    load();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [report.id, attempt, onExpired]);
  return <div className="report-preview">
    {preview.loading && <p role="status">Loading private preview...</p>}
    {preview.error && <div className="error" role="alert"><p>{preview.error}</p><button className="secondary" onClick={() => { setPreview({ url: "", error: "", loading: true }); setAttempt((n) => n + 1); }}>Retry preview</button></div>}
    {preview.url && <img src={preview.url} alt={`Preview of ${report.displayName}`} onError={() => setPreview((old) => ({ ...old, url: "", error: "This image could not be displayed. Use the authenticated download.", loading: false }))} />}
  </div>;
}
