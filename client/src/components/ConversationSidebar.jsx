export default function ConversationSidebar({ chat, disabled, onSelect }) {
  return <aside className="history-sidebar" aria-label="Saved conversations">
    <h2>Conversations</h2>
    <button className="full-width" onClick={chat.create} disabled={disabled || chat.working}>New chat</button>
    <p className="hint">Saved privately to your account.</p>
    {chat.listError && <p className="error" role="alert">{chat.listError}</p>}
    <button className="secondary full-width" onClick={() => chat.refreshList()} disabled={disabled || chat.listLoading || chat.working}>Refresh history</button>
    {chat.listLoading && <p role="status">Loading conversations...</p>}
    {!chat.listLoading && !chat.list.length && !chat.listError && <p className="hint">No saved conversations. Choose New chat to begin.</p>}
    <ul className="history-list">{chat.list.map((item) => <li key={item.id}>
      <button className={`history-item ${item.id === chat.selected ? "selected" : ""}`} aria-current={item.id === chat.selected ? "true" : undefined} disabled={disabled || chat.working} onClick={() => onSelect(item.id)}>
        <span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleDateString()}</small>
      </button>
    </li>)}</ul>
    {chat.listCursor && <button className="secondary full-width" disabled={disabled || chat.listLoading || chat.working} onClick={() => chat.refreshList(chat.listCursor)}>Load more conversations</button>}
  </aside>;
}
