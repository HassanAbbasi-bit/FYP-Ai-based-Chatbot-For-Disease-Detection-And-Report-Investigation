import { useRef, useState } from "react";
import { api } from "../api/client";

export default function AuthScreen({ onSignedIn, notice }) {
  const [registering, setRegistering] = useState(false);
  const [fields, setFields] = useState({ name: "", email: "", password: "", confirm: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const busy = useRef(false);
  const confirmationRef = useRef(null);
  function update(event) { setFields((current) => ({ ...current, [event.target.name]: event.target.value })); }
  function switchMode() {
    setRegistering(!registering);
    setFields({ name: "", email: "", password: "", confirm: "" });
    setError("");
  }
  async function submit(event) {
    event.preventDefault();
    if (busy.current) return;
    if (registering && fields.password !== fields.confirm) {
      setError("Passwords do not match.");
      confirmationRef.current?.focus();
      return;
    }
    busy.current = true;
    setLoading(true);
    setError("");
    try {
      const body = { email: fields.email, password: fields.password };
      if (registering) body.name = fields.name;
      const data = await api(registering ? "/auth/register" : "/auth/login", { method: "POST", body });
      setFields({ name: "", email: "", password: "", confirm: "" });
      onSignedIn(data.user);
    } catch (failure) {
      setError(failure.message);
      setFields((current) => ({ ...current, password: "", confirm: "" }));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }
  return (
    <section className="chat-panel auth-panel" aria-labelledby="auth-title">
      <p className="eyebrow">FYP · HEALTH WORKSPACE</p>
      <h1 id="auth-title">{registering ? "Create your account" : "Sign in"}</h1>
      <p className="demo-banner">Private account workspace. AI availability is shown after sign-in.</p>
      <p className="intro">Sign in to your saved conversations, reports and privacy controls.</p>
      {notice && <p role="status">{notice}</p>}
      {error && <p className="error" role="alert" id="auth-error">{error}</p>}
      <form onSubmit={submit} aria-describedby={error ? "auth-error" : undefined}>
        <fieldset disabled={loading}>
          {registering && <div className="field"><label htmlFor="name">Name</label><input id="name" name="name" autoComplete="name" required maxLength={80} value={fields.name} onChange={update} /></div>}
          <div className="field"><label htmlFor="email">Email</label><input id="email" name="email" type="email" autoComplete="email" required maxLength={254} value={fields.email} onChange={update} /></div>
          <div className="field"><label htmlFor="password">Password</label><input id="password" name="password" type="password" autoComplete={registering ? "new-password" : "current-password"} required minLength={15} maxLength={128} aria-describedby="password-help" value={fields.password} onChange={update} /><p className="hint" id="password-help">Use 15–128 characters. Spaces are allowed; a long passphrase works well.</p></div>
          {registering && <div className="field"><label htmlFor="confirm">Confirm password</label><input ref={confirmationRef} id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={fields.confirm} onChange={update} /></div>}
          <button className="full-width" type="submit">{loading ? "Please wait..." : registering ? "Create account" : "Sign in"}</button>
        </fieldset>
      </form>
      <p role="status" className="sending">{loading ? "Submitting account details..." : ""}</p>
      <button type="button" className="secondary full-width" onClick={switchMode} disabled={loading}>{registering ? "Already have an account? Sign in" : "New here? Create an account"}</button>
    </section>
  );
}
