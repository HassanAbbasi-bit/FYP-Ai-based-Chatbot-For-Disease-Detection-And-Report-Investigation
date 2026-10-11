import { useState } from "react";
import { api } from "../api/client";
export default function Symptoms({ available, onExpired }) {
  const [concern, setConcern] = useState(""), [duration, setDuration] = useState(""), [severity, setSeverity] = useState(""), [notes, setNotes] = useState("");
  const [result, setResult] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); setBusy(true); setError(""); setResult(null); try { setResult(await api("/symptoms", { method: "POST", body: { symptoms: concern.split("\n").filter((s) => s.trim()), duration: duration || null, severity: severity || null, additional_notes: notes || null } })); } catch (err) { if (err.status === 401) onExpired(); else setError(err.message); } finally { setBusy(false); } }
  return <section className="chat-panel"><h1>Symptom intake</h1><p>Share concerns in your own words, one per line. Optional information can stay unknown. Possibilities returned by the service are not diagnoses.</p>
    {!available && <p className="demo-banner">Symptom assessment is unavailable until the real service is configured. No synthetic medical findings are substituted.</p>}
    <form onSubmit={submit}><label>Main concerns<textarea value={concern} onChange={(e) => setConcern(e.target.value)} maxLength={2000} required /></label><label>Duration (optional)<input value={duration} onChange={(e) => setDuration(e.target.value)} maxLength={500} /></label><label>Severity in your words (optional)<input value={severity} onChange={(e) => setSeverity(e.target.value)} maxLength={500} /></label><label>Relevant notes (optional)<textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} /></label><button disabled={!available || busy}>Request assessment</button></form>
    {error && <p role="alert" className="error">{error}</p>}{result && <div><p className="demo-banner">Service urgency: {result.urgency}</p>{result.escalation && <p role="alert" className="error">{result.escalation}</p>}<p>{result.limitations}</p><ul>{result.possibleCauses.map((c, i) => <li key={i}><strong>{c.condition} — {c.likelihood}</strong><p>{c.rationale}</p></li>)}</ul><h2>Questions to discuss</h2><ul>{result.questions.map((q, i) => <li key={i}>{q}</li>)}</ul><p>{result.selfCare}</p></div>}
  </section>;
}
