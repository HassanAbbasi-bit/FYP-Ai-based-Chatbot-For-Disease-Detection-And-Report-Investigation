import { useRef, useState } from "react";
import Chat from "./Chat";
import Reports from "./Reports";
export default function Workspace(props) {
  const [view, setView] = useState("chat");
  const dirty = useRef(false);
  function guard() { return !dirty.current || window.confirm("Discard unsaved report review edits?"); }
  return <>
    <nav className="workspace-nav" aria-label="Account sections">
      <button className={view === "chat" ? "" : "secondary"} aria-current={view === "chat" ? "page" : undefined} onClick={() => { if (guard()) setView("chat"); }}>Chat</button>
      <button className={view === "reports" ? "" : "secondary"} aria-current={view === "reports" ? "page" : undefined} onClick={() => setView("reports")}>Reports</button>
      {view === "reports" && <button className="secondary" disabled={props.loggingOut} onClick={() => { if (guard()) props.onLogout(); }}>Sign out</button>}
    </nav>
    <div hidden={view !== "chat"}><Chat {...props} /></div>
    {view === "reports" && <Reports onExpired={props.onExpired} loggingOut={props.loggingOut} onDirtyChange={(value) => { dirty.current = value; }} />}
    {view === "reports" && props.logoutError && <p className="error" role="alert">{props.logoutError}</p>}
  </>;
}
