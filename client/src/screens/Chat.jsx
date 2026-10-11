import { useState } from "react";
import useConversations from "../hooks/useConversations";
import ConversationSidebar from "../components/ConversationSidebar";
import ConversationDialog from "../components/ConversationDialog";
import MessageHistory from "../components/MessageHistory";

export default function Chat({ user, onExpired, onLogout, loggingOut, logoutError, mode = "demo" }) {
  const chat = useConversations(onExpired);
  const [navigation, setNavigation] = useState(false);
  const [dialog, setDialog] = useState(null);
  const conversation = chat.list.find((item) => item.id === chat.selected);
  const thread = chat.thread;
  async function confirm(title) {
    const success = dialog.action === "delete" ? await chat.remove(dialog.conversation.id) : await chat.rename(dialog.conversation.id, title);
    if (success) setDialog(null);
  }
  return <section className="chat-panel history-panel" aria-labelledby="chat-title">
    <header>
      <div className="account-bar"><span>Signed in as <strong>{user.name}</strong> ({user.email})</span><button className="secondary" onClick={onLogout} disabled={loggingOut}>{loggingOut ? "Signing out..." : "Sign out"}</button></div>
      {logoutError && <p className="error" role="alert">{logoutError}</p>}
      <p className="eyebrow">FYP · DEVELOPMENT</p><h1 id="chat-title">AI Health Assistant</h1>
      <p className="demo-banner">{mode === "demo" ? "DEMO mode — AI is not connected. No medical analysis is performed." : "Configured AI service — consent required. Live model availability and clinical accuracy are not guaranteed."}</p>
      <p className="intro">Conversations are saved to your account and restored when you return. Use test messages only. You can permanently delete a conversation and its messages.</p>
      <button className="secondary mobile-history" aria-expanded={navigation} aria-controls="history-navigation" onClick={() => setNavigation((open) => !open)}>{navigation ? "Hide conversations" : "Show conversations"}</button>
    </header>
    <div className="history-layout">
      <div id="history-navigation" className={navigation ? "navigation open" : "navigation"}>
        <ConversationSidebar chat={chat} disabled={loggingOut} onSelect={(id) => { chat.select(id); setNavigation(false); }} />
      </div>
      <div className="chat-content">
        {!chat.selected ? <p className="empty">Choose a saved conversation or select New chat.</p> : <>
          <div className="thread-heading"><h2>{conversation?.title || "Conversation"}</h2><div className="thread-actions">
            <button className="secondary" onClick={() => setDialog({ action: "rename", conversation })} disabled={!conversation || chat.working || loggingOut}>Rename</button>
            <button className="secondary" onClick={() => setDialog({ action: "delete", conversation })} disabled={!conversation || chat.working || loggingOut}>Delete</button>
          </div></div>
          <MessageHistory thread={thread} selected={chat.selected} onOlder={chat.loadOlder} onReload={chat.reload} />
          <p className="sending" role="status">{thread.sending ? "Sending message..." : thread.pending ? "Your message is kept for a safe retry." : ""}</p>
          {thread.error && <div className="error" role="alert"><p>{thread.error}</p>{thread.pending ? <button onClick={() => chat.send(true)} disabled={thread.sending || loggingOut}>Retry message</button> : thread.loaded && <button className="secondary" onClick={chat.reload} disabled={thread.loading || loggingOut}>Refresh messages</button>}</div>}
          <form onSubmit={(event) => { event.preventDefault(); chat.send(); }}>
            <label htmlFor="message">Your message</label><textarea id="message" rows="3" maxLength={2000} value={thread.draft} onChange={(event) => chat.setDraft(event.target.value)} disabled={loggingOut || chat.working || !thread.loaded} aria-describedby="message-help character-count" />
            <div className="composer-footer"><span id="character-count">{thread.draft.length} / 2,000 characters</span><button type="submit" disabled={loggingOut || chat.working || thread.sending || Boolean(thread.pending) || !thread.loaded || !thread.draft.trim()}>Send message</button></div>
            <p id="message-help" className="hint">{thread.pending ? "Retry the submitted message before sending another. You can keep a draft here." : "Replies are demonstrations, not medical advice."}</p>
          </form>
        </>}
      </div>
    </div>
    {dialog && <ConversationDialog key={`${dialog.action}-${dialog.conversation.id}`} action={dialog.action} conversation={dialog.conversation} busy={chat.working} error={chat.listError} onClose={() => setDialog(null)} onConfirm={confirm} />}
  </section>;
}
