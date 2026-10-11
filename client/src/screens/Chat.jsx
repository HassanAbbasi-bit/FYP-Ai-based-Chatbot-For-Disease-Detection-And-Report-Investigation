import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";

function Chat({ user, onExpired, onLogout, loggingOut, logoutError }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Not checked yet");
  const [checking, setChecking] = useState(false);
  const busy = useRef(false);
  const checkingRef = useRef(false);
  const inputRef = useRef(null);
  const conversationRef = useRef(null);

  useEffect(() => {
    if (conversationRef.current) conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (!sending && !pending && !loggingOut) inputRef.current?.focus();
  }, [sending, pending, loggingOut]);

  async function checkConnection() {
    if (checkingRef.current) return;
    checkingRef.current = true;
    setChecking(true);
    setConnection("Checking...");
    try {
      const response = await fetch("/api/health", { signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      if (!response.ok || data.status !== "ok" || data.service !== "express-api") throw new Error();
      setConnection(`Connected — ${data.message}`);
    } catch {
      setConnection("Connection failed. Start Express in the server folder and try again.");
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }

  async function sendMessage(retry = false) {
    if (busy.current || loggingOut) return;
    const outgoing = retry ? pending : { id: crypto.randomUUID(), text: draft };
    if (!outgoing || !outgoing.text.trim() || outgoing.text.length > 2000) return;
    busy.current = true;
    setSending(true);
    setError("");
    setPending(outgoing);
    if (!retry) {
      setMessages((current) => [...current, { ...outgoing, role: "user" }]);
      setDraft("");
    }
    try {
      const data = await api("/chat", { method: "POST", body: { message: outgoing.text } });
      if (data.mode !== "demo" || typeof data.reply !== "string" || !data.reply.trim()) {
        throw new Error("Unexpected demo response. Check the server, then retry.");
      }
      setMessages((current) => [...current, { id: crypto.randomUUID(), text: data.reply, role: "assistant" }]);
      setPending(null);
    } catch (failure) {
      if (failure.status === 401) { onExpired(); return; }
      setError(failure.name === "TimeoutError"
        ? "The request timed out after 15 seconds. Your message is kept below; retry when the server is ready."
        : failure instanceof TypeError
          ? "Could not reach the server. Start Express and check your connection, then retry."
          : failure.message);
    } finally {
      busy.current = false;
      setSending(false);
    }
  }

  return (
    <div>
      <section className="chat-panel" aria-labelledby="chat-title">
        <header>
          <div className="account-bar"><span>Signed in as <strong>{user.name}</strong> ({user.email})</span><button type="button" className="secondary" onClick={onLogout} disabled={loggingOut || sending}>{loggingOut ? "Signing out..." : "Sign out"}</button></div>
          {logoutError && <p className="error" role="alert">{logoutError}</p>}
          <p className="eyebrow">FYP · DEVELOPMENT</p>
          <h1 id="chat-title">AI Health Assistant</h1>
          <p className="demo-banner">Demo mode — AI is not connected.</p>
          <p className="intro">This chat tests the React–Express connection. No medical analysis is performed. Messages stay in memory; refreshing clears them.</p>
          <div className="connection">
            <button type="button" className="secondary" onClick={checkConnection} disabled={checking}>{checking ? "Checking..." : "Check server connection"}</button>
            <span role="status">{connection}</span>
          </div>
        </header>
        <div ref={conversationRef} className="conversation" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions">
          {messages.length === 0 ? <p className="empty">No messages yet. Send a message to test the demo chat.</p> : messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              <strong>{message.role === "user" ? "You" : "Assistant · Demo"}</strong>
              <p>{message.text}</p>
            </article>
          ))}
        </div>
        <p className="sending" role="status">{sending ? "Sending message..." : ""}</p>
        {error && <div className="error" role="alert"><p>{error}</p><button type="button" onClick={() => sendMessage(true)} disabled={sending || loggingOut}>Retry message</button></div>}
        <form onSubmit={(event) => { event.preventDefault(); sendMessage(); }}>
          <label htmlFor="message">Your message</label>
          <textarea ref={inputRef} id="message" rows="3" maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={sending || loggingOut || Boolean(pending)} aria-describedby="message-help character-count" />
          <div className="composer-footer"><span id="character-count">{draft.length} / 2,000 characters</span><button type="submit" disabled={sending || loggingOut || Boolean(pending) || !draft.trim()}>Send message</button></div>
          <p id="message-help" className="hint">{pending ? "Your submitted message is kept in the conversation. Retry it before sending another message." : "Use test messages only. This checkpoint does not provide medical advice."}</p>
        </form>
      </section>
    </div>
  );
}
export default Chat;
