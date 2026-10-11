import { useEffect, useRef, useState } from "react";
export default function ConversationDialog({ action, conversation, busy, error, onClose, onConfirm }) {
  const dialog = useRef(null);
  const [title, setTitle] = useState(conversation.title);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  const deleting = action === "delete";
  return <dialog ref={dialog} className="conversation-dialog" aria-labelledby="dialog-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); onConfirm(title); }}>
      <h2 id="dialog-title">{deleting ? "Delete conversation?" : "Rename conversation"}</h2>
      {error && <p className="error" role="alert">{error}</p>}
      {deleting ? <p>This permanently removes this conversation and its messages from your account. You cannot undo it.</p> : <>
        <label htmlFor="conversation-title">Conversation title</label>
        <input id="conversation-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required disabled={busy} />
      </>}
      <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className={deleting ? "danger" : ""} disabled={busy || (!deleting && !title.trim())}>{busy ? "Saving..." : deleting ? "Delete permanently" : "Save title"}</button></div>
    </form>
  </dialog>;
}
