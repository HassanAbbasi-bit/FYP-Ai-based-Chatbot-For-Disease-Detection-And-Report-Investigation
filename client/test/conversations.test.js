import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcileMessages } from "../src/api/conversations.js";
test("server records replace optimistic messages by request ID and role without duplicating retries", () => {
  const optimistic = { id: "temporary", requestId: "one", role: "user", content: "Synthetic", optimistic: true };
  const saved = { ...optimistic, id: "persisted", sequence: 1, optimistic: false };
  const reply = { id: "reply", requestId: "one", role: "assistant", content: "DEMO", sequence: 2 };
  const first = reconcileMessages([optimistic], [saved, reply]);
  assert.deepEqual(first, [saved, reply]);
  assert.deepEqual(reconcileMessages(first, [saved, reply]), first);
});
test("older history pages merge in sequence order without losing a pending submission", () => {
  const pending = { id: "pending", requestId: "new", role: "user" };
  const recent = { id: "recent", requestId: "second", role: "user", sequence: 3 };
  const older = { id: "older", requestId: "first", role: "user", sequence: 1 };
  assert.deepEqual(reconcileMessages([recent, pending], [older]), [older, recent, pending]);
});
