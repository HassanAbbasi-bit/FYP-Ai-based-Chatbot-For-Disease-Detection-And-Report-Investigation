import { useEffect, useState } from "react";
import { api } from "../api/client";
export default function Settings({ onExpired, onSaved }) {
  const [data, setData] = useState(null), [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => { const c = new AbortController(); api("/account", { signal: c.signal }).then(setData).catch((e) => { if (!c.signal.aborted) { if (e.status === 401) onExpired(); else setError(e.message); } }); return () => c.abort(); }, [onExpired]);
  async function save(event) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/account", { method: "PUT", body: { name: data.name, healthContext: data.healthContext, consent: { chat: data.consent.chat, reports: data.consent.reports, profile: data.consent.profile, noticeVersion: data.noticeVersion }, expectedVersion: data.version } }); const next = await api("/account"); setData(next); onSaved?.(next); setNotice("Settings saved."); }
    catch (e) { if (e.status === 401) onExpired(); else setError(e.message); } finally { setBusy(false); }
  }
  return <section className="chat-panel"><h1>Settings and privacy</h1><p>Optional context is for your account records. Missing information stays unknown. It is not automatically sent with messages or reports. Age and date of birth are not collected.</p>
    {error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!data ? <p>Loading settings...</p> : <form onSubmit={save}>
      <label>Display name<input value={data.name} maxLength={80} required onChange={(e) => setData({ ...data, name: e.target.value })} /></label>
      {["medications", "allergies", "conditions"].map((key) => <label key={key}>Optional {key}<textarea maxLength={500} value={data.healthContext?.[key] ?? ""} onChange={(e) => setData({ ...data, healthContext: { ...data.healthContext, [key]: e.target.value || null } })} /></label>)}
      <button type="button" className="secondary" onClick={() => setData({ ...data, healthContext: { medications: null, allergies: null, conditions: null } })}>Clear optional context</button>
      <h2>AI processing choices</h2><p>When a real service is configured, permitted data is sent to that service for processing. Its retention and deletion guarantees are not yet confirmed. Synthetic demos run locally. Withdrawing consent blocks new transfers; it does not recall already-sent data or delete your saved records. Use separate deletion controls to remove application data.</p>
      {[ ["chat", "Allow chat and symptom data to be sent for AI processing"], ["reports", "Allow reports and reviewed values to be sent for AI processing"], ["profile", "Allow necessary optional profile context when a sharing contract is agreed"] ].map(([key, label]) => <label key={key} className="checkbox-label"><input type="checkbox" checked={Boolean(data.consent?.[key])} onChange={(e) => setData({ ...data, consent: { ...data.consent, [key]: e.target.checked } })} />{label}</label>)}
      <p className="hint">Notice {data.noticeVersion}. Profile sharing is not connected; this preference does not transmit context. Consent is not a compliance certification.</p><button disabled={busy}>{busy ? "Saving..." : "Save settings"}</button>
    </form>}
  </section>;
}
