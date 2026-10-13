import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import Settings from "./Settings";
import Symptoms from "./Symptoms";
import Chat from "./Chat";
import Reports from "./Reports";
import Dashboard from './Dashboard';
export default function Workspace(props) {
  const [view, setView] = useState("dashboard");
  const dirty = useRef(false);
  const [account, setAccount] = useState(null);
  const [chatContext,setChatContext]=useState(null);
  useEffect(() => { const c = new AbortController(); api("/account", { signal: c.signal }).then(setAccount).catch(() => {}); return () => c.abort(); }, []);
  function guard() { return !dirty.current || window.confirm("Discard unsaved edits?"); }
  return <div className="workspace-shell">
    <aside className="workspace-rail"><div className="brand"><span className="brand-mark" aria-hidden="true">◉</span><div>Blood CP<span>REPORT INTELLIGENCE</span></div></div>
    <nav className="workspace-nav" aria-label="Account sections">
      <button className={view==='dashboard'?'':'secondary'} aria-current={view==='dashboard'?'page':undefined} onClick={()=>{if(guard())setView('dashboard');}}>Dashboard</button>
      <button className={view === "chat" ? "" : "secondary"} aria-current={view === "chat" ? "page" : undefined} onClick={() => { if (guard()) setView("chat"); }}>Chat</button>
      <button className={view === "reports" ? "" : "secondary"} aria-current={view === "reports" ? "page" : undefined} onClick={() => {if(guard())setView("reports");}}>Reports</button>
      <button className="secondary" aria-current={view==='symptoms'?'page':undefined} onClick={() => { if (guard()) setView("symptoms"); }}>Symptoms</button>
      <button className="secondary" aria-current={view==='settings'?'page':undefined} onClick={() => { if (guard()) setView("settings"); }}>Settings</button>
      {view !== "chat" && <button className="secondary" disabled={props.loggingOut} onClick={() => { if (guard()) props.onLogout(); }}>Sign out</button>}
    </nav>
    <div className="rail-note"><span aria-hidden="true">✧</span><strong>A clearer picture of your blood report</strong><p>Review your values. Explore findings. Prepare for your doctor.</p></div></aside>
    <div className="workspace-main"><header className="workspace-topbar"><span>YOUR PRIVATE HEALTH WORKSPACE</span><span className="profile-chip">{account?.name||props.user.name}</span></header>
    <div hidden={view !== "chat"}><Chat key={chatContext?.key||'general'} {...props} initialContext={chatContext?.context} user={{ ...props.user, name: account?.name || props.user.name }} mode={account?.capabilities?.chat || 'unavailable'} /></div>
    {view==='dashboard'&&<Dashboard name={account?.name||props.user.name} onNavigate={setView}/>}
    {view === "settings" && <Settings onExpired={props.onExpired} onSaved={setAccount} onDeleted={props.onDeleted} onConversationsDeleted={()=>setChatContext({key:crypto.randomUUID()})} onDirtyChange={value=>{dirty.current=value;}}/>}
    {view === "symptoms" && <Symptoms available={account?.capabilities?.symptoms} onExpired={props.onExpired} />}
    {view === "reports" && <Reports onExpired={props.onExpired} loggingOut={props.loggingOut} onOpenChat={context=>{setChatContext({context,key:crypto.randomUUID()});setView('chat');}} onDirtyChange={(value) => { dirty.current = value; }} />}
    {view === "reports" && props.logoutError && <p className="error" role="alert">{props.logoutError}</p>}
    <footer className="workspace-footer">Blood CP · Educational report investigation. Clinical diagnosis belongs to your healthcare professional.</footer></div></div>;
}
