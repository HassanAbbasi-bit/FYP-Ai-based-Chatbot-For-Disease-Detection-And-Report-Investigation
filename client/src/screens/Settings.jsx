import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import PrivacyControls from '../components/PrivacyControls';
export default function Settings({ onExpired, onSaved, onDeleted, onConversationsDeleted, onDirtyChange }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false), [hasEdits, setHasEdits] = useState(false);
  const callbacks=useRef({onExpired,onSaved,onDirtyChange}),requests=useRef(new Set()),dirty=useRef(false);
  useEffect(()=>{callbacks.current={onExpired,onSaved,onDirtyChange};},[onExpired,onSaved,onDirtyChange]);
  useEffect(() => { const c = new AbortController(),active=requests.current;active.add(c); api("/account", { signal: c.signal }).then(next=>{if(!c.signal.aborted)setData(next);}).catch((e) => { if (!c.signal.aborted) { if (e.status === 401) callbacks.current.onExpired(); else setError(e.message); } }); function warn(e){if(dirty.current){e.preventDefault();e.returnValue='';}}window.addEventListener('beforeunload',warn);return () => {active.forEach(c=>c.abort());active.clear();callbacks.current.onDirtyChange?.(false);window.removeEventListener('beforeunload',warn);}; }, []);
  function edit(next){setData(next);setNotice("");setHasEdits(true);dirty.current=true;callbacks.current.onDirtyChange?.(true);}
  async function save(event) {
    event.preventDefault(); if(busy)return;setBusy(true); setError("");const c=new AbortController();requests.current.add(c);
    try { await api("/account", { method: "PUT", signal:c.signal, body: { name: data.name, healthContext: data.healthContext, consent: { chat: data.consent.chat, reports: data.consent.reports, profile: data.consent.profile, noticeVersion: data.noticeVersion }, expectedVersion: data.version } }); const next = await api("/account",{signal:c.signal}); if(!c.signal.aborted){setData(next);setHasEdits(false);dirty.current=false;callbacks.current.onDirtyChange?.(false);callbacks.current.onSaved?.(next);setNotice("Settings saved.");} }
    catch (e) { if(!c.signal.aborted){if (e.status === 401) callbacks.current.onExpired(); else setError(e.message);} } finally { requests.current.delete(c);if(!c.signal.aborted)setBusy(false); }
  }
  return <section className="chat-panel"><h1>Settings and privacy</h1><p>Optional context is for your account records. Missing information stays unknown. It is not automatically sent with messages or reports. Age and date of birth are not collected.</p>
    {!data && error && <p role="alert" className="error">{error}</p>}
    {!data ? <p>Loading settings...</p> : <form onSubmit={save}>
      <label>Display name<input value={data.name} maxLength={80} required onChange={(e) => edit({ ...data, name: e.target.value })} /></label>
      {["medications", "allergies", "conditions"].map((key) => <label key={key}>Optional {key}<textarea maxLength={500} value={data.healthContext?.[key] ?? ""} onChange={(e) => edit({ ...data, healthContext: { ...data.healthContext, [key]: e.target.value || null } })} /></label>)}
      <button type="button" className="secondary" onClick={() => edit({ ...data, healthContext: { medications: null, allergies: null, conditions: null } })}>Clear optional context</button>
      <h2>AI processing choices</h2><p>When a real service is configured, permitted data is sent to that service for processing. Its retention and deletion guarantees are not yet confirmed. Synthetic demos run locally. Withdrawing consent blocks new transfers; it does not recall already-sent data or delete your saved records. Use separate deletion controls to remove application data.</p>
      {[ ["chat", "Allow chat and symptom data to be sent for AI processing"], ["reports", "Allow reports and reviewed values to be sent for AI processing"], ["profile", "Allow necessary optional profile context when a sharing contract is agreed"] ].map(([key, label]) => <label key={key} className="checkbox-label"><input type="checkbox" checked={Boolean(data.consent?.[key])} onChange={(e) => edit({ ...data, consent: { ...data.consent, [key]: e.target.checked } })} />{label}</label>)}
      <p className="hint">Notice {data.noticeVersion}. Profile sharing is not connected; this preference does not transmit context. Consent is not a compliance certification.</p>
      {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
      {hasEdits && !busy && <p className="hint">Changes are not saved yet. Click Save settings to keep your choices.</p>}
      <button type="submit" disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
      <button type="button" className="secondary" disabled={busy} onClick={async()=>{if(dirty.current&&!window.confirm('Discard unsaved settings edits and reload?'))return;const c=new AbortController();requests.current.add(c);try{const next=await api('/account',{signal:c.signal});if(!c.signal.aborted){setData(next);setHasEdits(false);dirty.current=false;callbacks.current.onDirtyChange?.(false);setError('');}}catch(e){if(!c.signal.aborted){if(e.status===401)callbacks.current.onExpired();else setError(e.message);}}finally{requests.current.delete(c);}}}>Reload saved settings</button>
    </form>}
    <PrivacyControls onExpired={onExpired} onDeleted={onDeleted} onConversationsDeleted={onConversationsDeleted}/>
  </section>;
}
