import { useEffect, useRef } from "react";
export default function MessageHistory({ thread, selected, onOlder, onReload }) {
  const panel = useRef(null);
  const nearBottom = useRef(true);
  const previous = useRef(null);
  const count = thread.messages.length;
  useEffect(() => {
    if (previous.current !== selected) { previous.current = selected; nearBottom.current = true; }
    if (nearBottom.current && panel.current) panel.current.scrollTop = panel.current.scrollHeight;
  }, [selected, count]);
  async function older() {
    const element = panel.current;
    const height = element.scrollHeight, top = element.scrollTop;
    nearBottom.current = false;
    await onOlder();
    requestAnimationFrame(() => { if (panel.current === element) element.scrollTop = top + element.scrollHeight - height; });
  }
  return <div ref={panel} className="conversation" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions" aria-busy={thread.loading} onScroll={() => {
    const element = panel.current;
    nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }}>
    {thread.nextCursor && <button className="secondary" disabled={thread.loading} onClick={older}>Load older messages</button>}
    {thread.loading && <p role="status">Loading messages...</p>}
    {!thread.loading && !thread.loaded && thread.error && <button className="secondary" onClick={onReload}>Retry loading messages</button>}
    {!count && !thread.loading && thread.loaded && <p className="empty">No messages yet. Send a test message.</p>}
    {thread.messages.map((message) => <article key={message.id} className={`bubble ${message.role}`}>
      <strong>{message.role === "user" ? "You" : message.mode === "ai" ? "Assistant · Service response" : "Assistant · DEMO"}</strong><p>{message.content}</p>
      {message.structured && <><p className="demo-banner">Service urgency: {message.structured.urgency}</p><ul>{message.structured.followUps?.map((q, i) => <li key={i}>{q}</li>)}</ul><p>{message.structured.disclaimer}</p></>}
      {message.role === "user" && thread.pending?.requestId === message.requestId && <small>{thread.sending ? "Sending..." : thread.pending.status === "pending" ? "Awaiting confirmation" : "Needs retry"}</small>}
    </article>)}
  </div>;
}
