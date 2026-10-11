import { api } from "./client.js";
const root = "/conversations";
const page = (cursor) => cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
export const conversationsApi = {
  list: (cursor, signal) => api(`${root}${page(cursor)}`, { signal }),
  create: (signal, body = {}) => api(root, { method: "POST", body, signal }),
  messages: (id, cursor, signal) => api(`${root}/${id}/messages${page(cursor)}`, { signal }),
  send: (id, submission, signal) => api(`${root}/${id}/messages`, { method: "POST", body: { message: submission.content, requestId: submission.requestId }, signal }),
  rename: (id, title, signal) => api(`${root}/${id}`, { method: "PATCH", body: { title }, signal }),
  remove: (id, signal) => api(`${root}/${id}`, { method: "DELETE", signal }),
};
export function reconcileMessages(current, incoming) {
  const rows = new Map(current.map((message) => [`${message.requestId}:${message.role}`, message]));
  for (const message of incoming) rows.set(`${message.requestId}:${message.role}`, message);
  return [...rows.values()].sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity));
}
