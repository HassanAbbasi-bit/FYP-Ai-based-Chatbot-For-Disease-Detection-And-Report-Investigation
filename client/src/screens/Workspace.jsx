import { useState } from "react";
import Chat from "./Chat";
import Reports from "./Reports";
export default function Workspace(props) {
  const [view, setView] = useState("chat");
  return <>
    <nav className="workspace-nav" aria-label="Account sections">
      <button className={view === "chat" ? "" : "secondary"} aria-current={view === "chat" ? "page" : undefined} onClick={() => setView("chat")}>Chat</button>
      <button className={view === "reports" ? "" : "secondary"} aria-current={view === "reports" ? "page" : undefined} onClick={() => setView("reports")}>Reports</button>
      {view === "reports" && <button className="secondary" disabled={props.loggingOut} onClick={props.onLogout}>Sign out</button>}
    </nav>
    <div hidden={view !== "chat"}><Chat {...props} /></div>
    {view === "reports" && <Reports onExpired={props.onExpired} loggingOut={props.loggingOut} />}
    {view === "reports" && props.logoutError && <p className="error" role="alert">{props.logoutError}</p>}
  </>;
}
