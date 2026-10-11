import { useEffect, useRef } from "react";
export default function ReportDeleteDialog({ busy, error, onClose, onConfirm }) {
  const dialog = useRef(null);
  useEffect(() => {
    const element = dialog.current, previous = document.activeElement;
    element.showModal(); return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="conversation-dialog" aria-labelledby="report-delete-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="report-delete-title">Delete this report?</h2>
    <p>This permanently removes the private original file and its library entry. You cannot undo it. Downloaded copies and provider backups are outside this deletion.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="dialog-actions"><button className="secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="danger" disabled={busy} onClick={onConfirm}>{busy ? "Deleting..." : "Delete permanently"}</button></div>
  </dialog>;
}
