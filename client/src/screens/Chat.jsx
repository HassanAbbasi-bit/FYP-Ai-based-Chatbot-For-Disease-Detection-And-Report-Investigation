import { useState } from "react";
import useConversations from "../hooks/useConversations";
import ConversationSidebar from "../components/ConversationSidebar";
import ConversationDialog from "../components/ConversationDialog";
import MessageHistory from "../components/MessageHistory";
import ReviewedMeasurements from "../components/ReviewedMeasurements";

export default function Chat({ onExpired, loggingOut, logoutError, mode = "demo", initialContext }) {
  const chat = useConversations(onExpired, initialContext);
  const [navigation, setNavigation] = useState(false);
  const [dialog, setDialog] = useState(null);
  const conversation = chat.list.find((item) => item.id === chat.selected);
  const thread = chat.thread;
  const canSend = mode !== 'unavailable' && !loggingOut && !chat.working && !thread.sending && !thread.pending && thread.loaded && Boolean(thread.draft.trim());
  async function confirm(title) {
    const success = dialog.action === "delete" ? await chat.remove(dialog.conversation.id) : await chat.rename(dialog.conversation.id, title);
    if (success) setDialog(null);
  }
  return <section className="chat-panel history-panel premium-chat" aria-labelledby="chat-title">
    <header>
      {logoutError && <p className="error" role="alert">{logoutError}</p>}
      <p className="eyebrow">BLOOD CP · ASK & UNDERSTAND</p><h1 id="chat-title">A clearer conversation.</h1>
      <p className="demo-banner">{mode === "demo" ? "DEMO — AI is not connected. No medical analysis is performed." : mode==='unavailable'?'AI is unavailable. Your saved conversations remain accessible.':"AI service configured · Educational guidance, subject to physician confirmation."}</p>
      <p className="intro">Understand your blood report. Explore possible causes. Know what to ask your physician.</p>
      <button className="secondary mobile-history" aria-expanded={navigation} aria-controls="history-navigation" onClick={() => setNavigation((open) => !open)}>{navigation ? "Hide conversations" : "Show conversations"}</button>
    </header>
    <div className="history-layout">
      <div id="history-navigation" className={navigation ? "navigation open" : "navigation"}>
        <ConversationSidebar chat={chat} disabled={loggingOut} onSelect={(id) => { chat.select(id); setNavigation(false); }} />
      </div>
      <div className="chat-content">
        {!chat.selected ? <div className="chat-welcome"><span className="welcome-symbol" aria-hidden="true">✦</span><p className="eyebrow">YOUR PRIVATE REPORT COMPANION</p><h2>Start with a question.</h2><p>From unfamiliar test names to your next doctor visit, take it one question at a time.</p><button onClick={chat.create} disabled={chat.working || loggingOut}>Start a new conversation</button><div className="welcome-topics"><span>Understand CBC values</span><span>Explore possible causes</span><span>Prepare for your appointment</span></div><p className="hint">For image or PDF questions, upload and review the document in Reports first.</p></div> : <>
          <div className="thread-heading"><h2>{conversation?.title || "Conversation"}</h2><div className="thread-actions">
            <button className="secondary" onClick={() => setDialog({ action: "rename", conversation })} disabled={!conversation || chat.working || loggingOut}>Rename</button>
            <button className="secondary" onClick={() => setDialog({ action: "delete", conversation })} disabled={!conversation || chat.working || loggingOut}>Delete</button>
          </div></div>
          {conversation?.reportId&&<p className="demo-banner">Reviewed report · revision {conversation.reviewVersion}. {thread.reportContext?.outdated?'Outdated: open a new conversation for the current revision.':mode==='configured-fastapi'?'Uses your saved reviewed entries.':'Dedicated synthetic demonstration.'}</p>}
          {thread.reportContext?.rows&&<ReviewedMeasurements rows={thread.reportContext.rows} caption={`Report values attached to chat - revision ${thread.reportContext.reviewVersion}`}/>}
          <MessageHistory thread={thread} selected={chat.selected} onOlder={chat.loadOlder} onReload={chat.reload} onExpired={onExpired}/>
          <p className="sending" role="status">{thread.sending ? "Sending message..." : thread.pending ? "Your message is kept for a safe retry." : ""}</p>
          {thread.error && <div className="error" role="alert"><p>{thread.error}</p>{thread.pending ? <button onClick={() => chat.send(true)} disabled={thread.sending || loggingOut}>Retry message</button> : thread.loaded && <button className="secondary" onClick={chat.reload} disabled={thread.loading || loggingOut}>Refresh messages</button>}</div>}
          <form className="message-composer" onSubmit={(event) => { event.preventDefault(); if(canSend)chat.send(); }}>
            <label htmlFor="message">Your message</label><textarea id="message" rows="3" placeholder="Ask about a value, a possible cause, or your next step…" maxLength={2000} value={thread.draft} onChange={(event) => chat.setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing&&!event.ctrlKey&&!event.altKey&&!event.metaKey){event.preventDefault();if(canSend)event.currentTarget.form.requestSubmit();}}} disabled={loggingOut || chat.working || !thread.loaded} aria-describedby="message-help character-count" />
            <div className="composer-footer"><span id="character-count">Enter to send · Shift + Enter for a new line · {thread.draft.length}/2,000</span><button type="submit" disabled={!canSend}>Send message <span aria-hidden="true">↗</span></button></div>
            <p id="message-help" className="hint">{thread.pending ? "Retry the submitted message before sending another. You can keep a draft here." : mode==='demo'?"Replies are demonstrations, not medical advice.":'Service responses may be incomplete or uncertain; possibilities are not diagnoses.'}</p>
          </form>
        </>}
      </div>
    </div>
    {dialog && <ConversationDialog key={`${dialog.action}-${dialog.conversation.id}`} action={dialog.action} conversation={dialog.conversation} busy={chat.working} error={chat.listError} onClose={() => setDialog(null)} onConfirm={confirm} />}
  </section>;
}
