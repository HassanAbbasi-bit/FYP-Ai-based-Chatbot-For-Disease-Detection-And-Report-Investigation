import { useEffect, useRef, useState } from "react";
import { conversationsApi, reconcileMessages } from "../api/conversations";

const emptyThread = () => ({ messages: [], draft: "", pending: null, sending: false, loading: false, error: "", nextCursor: null, loaded: false });
export default function useConversations(onExpired) {
  const [list, setList] = useState([]);
  const [listCursor, setListCursor] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState(null);
  const [threads, setThreads] = useState({});
  const [working, setWorking] = useState(false);
  const alive = useRef(false);
  const selectedRef = useRef(null);
  const threadsRef = useRef({});
  const deleted = useRef(new Set());
  const busy = useRef(new Set());
  const loads = useRef(new Map());
  const requests = useRef(new Set());
  const listVersion = useRef(0);
  const operationBusy = useRef(false);
  const expiredRef = useRef(onExpired);
  useEffect(() => { expiredRef.current = onExpired; }, [onExpired]);
  function controller() {
    const c = new AbortController(); requests.current.add(c); return c;
  }
  function update(id, change) {
    if (!alive.current || deleted.current.has(id)) return;
    const previous = threadsRef.current[id] || emptyThread();
    const next = typeof change === "function" ? change(previous) : { ...previous, ...change };
    threadsRef.current = { ...threadsRef.current, [id]: next };
    setThreads(threadsRef.current);
  }
  function upsert(conversation) {
    if (!alive.current || deleted.current.has(conversation.id)) return;
    setList((current) => [...current.filter((c) => c.id !== conversation.id), conversation]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)));
  }
  function failure(error) {
    if (error.status === 401 && alive.current) { expiredRef.current(); return true; }
    return error.name === "AbortError" || !alive.current;
  }
  async function loadThread(id, cursor) {
    loads.current.get(id)?.abort();
    const c = controller(); loads.current.set(id, c);
    update(id, { loading: true, error: "" });
    try {
      const data = await conversationsApi.messages(id, cursor, c.signal);
      if (c.signal.aborted || !alive.current || deleted.current.has(id)) return;
      upsert(data.conversation);
      update(id, (old) => {
        const messages = reconcileMessages(cursor ? old.messages : old.messages.filter((m) => m.optimistic), data.messages);
        const completed = old.pending && messages.some((m) => m.requestId === old.pending.requestId && m.role === "assistant");
        const pending = data.activeRequest || (completed ? null : old.pending);
        if (pending && !messages.some((m) => m.requestId === pending.requestId && m.role === "user")) {
          messages.push({ id: `pending-${pending.requestId}`, requestId: pending.requestId, content: pending.content, role: "user", mode: "demo", optimistic: true });
        }
        return { ...old, messages, pending, nextCursor: data.nextCursor, loading: false, loaded: true,
          error: pending ? "This message needs confirmation. Retry to check or finish it safely." : "" };
      });
    } catch (error) {
      if (!failure(error) && !c.signal.aborted) update(id, { error: error.message, loading: false });
    } finally { requests.current.delete(c); }
  }
  async function refreshList(cursor) {
    const version = ++listVersion.current;
    const c = controller();
    setListLoading(true); setListError("");
    try {
      const data = await conversationsApi.list(cursor, c.signal);
      if (!alive.current || c.signal.aborted || version !== listVersion.current) return;
      setList((old) => {
        // Keep the selected thread available even if it falls beyond the first page.
        const merged = new Map((cursor ? old : old.filter((item) => item.id === selectedRef.current)).map((item) => [item.id, item]));
        for (const item of data.conversations) if (!deleted.current.has(item.id)) merged.set(item.id, item);
        return [...merged.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
      });
      setListCursor(data.nextCursor);
      if (!cursor && !selectedRef.current && data.conversations.length) {
        const id = data.conversations[0].id;
        selectedRef.current = id; setSelected(id);
        await loadThread(id);
      }
    } catch (error) {
      if (!failure(error) && version === listVersion.current) setListError(error.message);
    } finally {
      requests.current.delete(c);
      if (alive.current && version === listVersion.current) setListLoading(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    let disposed = false;
    queueMicrotask(() => { if (!disposed) refreshList(); });
    const controllers = requests.current;
    return () => { disposed = true; alive.current = false; for (const c of controllers) c.abort(); controllers.clear(); };
    // Account changes remount this hook. Functions read the current state through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function select(id) {
    if (deleted.current.has(id)) return;
    const old = selectedRef.current;
    if (old && old !== id) { loads.current.get(old)?.abort(); update(old, { loading: false }); }
    selectedRef.current = id; setSelected(id);
    loadThread(id);
  }
  async function operation(work) {
    if (operationBusy.current || !alive.current) return;
    operationBusy.current = true; setWorking(true); setListError("");
    const c = controller();
    try { await work(c.signal); }
    catch (error) { if (!failure(error)) setListError(error.message); }
    finally { requests.current.delete(c); operationBusy.current = false; if (alive.current) setWorking(false); }
  }
  async function create() {
    await operation(async (signal) => {
      const data = await conversationsApi.create(signal);
      if (!alive.current) return;
      upsert(data.conversation); select(data.conversation.id);
    });
  }
  async function rename(id, title) {
    let success = false;
    await operation(async (signal) => {
      const data = await conversationsApi.rename(id, title, signal);
      if (!alive.current) return;
      upsert(data.conversation); success = true;
    });
    return success;
  }
  async function remove(id) {
    let success = false;
    await operation(async (signal) => {
      try { await conversationsApi.remove(id, signal); }
      catch (error) { if (error.status !== 404) throw error; }
      if (!alive.current) return;
      deleted.current.add(id); loads.current.get(id)?.abort();
      setList((old) => old.filter((item) => item.id !== id));
      delete threadsRef.current[id]; setThreads({ ...threadsRef.current });
      if (selectedRef.current === id) { selectedRef.current = null; setSelected(null); }
      success = true;
    });
    return success;
  }
  async function send(retry = false) {
    const id = selectedRef.current;
    if (!id || busy.current.has(id) || deleted.current.has(id)) return;
    const thread = threadsRef.current[id] || emptyThread();
    const submission = retry ? thread.pending : { requestId: crypto.randomUUID(), content: thread.draft, status: "pending" };
    if (!submission || !submission.content.trim() || submission.content.length > 2000 || (!retry && thread.pending)) return;
    busy.current.add(id);
    loads.current.get(id)?.abort();
    update(id, (old) => ({ ...old, loading: false, sending: true, error: "", pending: submission,
      draft: retry ? old.draft : "", messages: reconcileMessages(old.messages, [{ id: `pending-${submission.requestId}`, requestId: submission.requestId, content: submission.content, role: "user", mode: "demo", optimistic: true }]) }));
    const c = controller();
    try {
      const data = await conversationsApi.send(id, submission, c.signal);
      if (!alive.current || deleted.current.has(id)) return;
      loads.current.get(id)?.abort();
      update(id, { loading: false });
      if (data.status === "pending") {
        update(id, { pending: { ...submission, status: "pending" }, error: "The server is processing this message. Retry shortly to retrieve its result." });
      } else if (data.status === "completed" && Array.isArray(data.messages)) {
        upsert(data.conversation);
        update(id, (old) => ({ ...old, messages: reconcileMessages(old.messages, data.messages), pending: null, error: "" }));
      } else throw new Error("Unexpected server response. Retry the saved submission.");
    } catch (error) {
      if (!failure(error)) update(id, { pending: { ...submission, status: "failed" }, error: error.message });
    } finally { requests.current.delete(c); busy.current.delete(id); update(id, { sending: false }); }
  }
  return { list, listCursor, listLoading, listError, selected, thread: threads[selected] || emptyThread(), working,
    refreshList, select, create, rename, remove, send, reload: () => selected && loadThread(selected),
    loadOlder: () => selected && loadThread(selected, threadsRef.current[selected]?.nextCursor),
    setDraft: (draft) => selected && update(selected, { draft }) };
}
