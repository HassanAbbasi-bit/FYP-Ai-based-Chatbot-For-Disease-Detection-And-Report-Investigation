const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/app");
let server;
let base;
before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));

test("health endpoint remains available", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).service, "express-api");
});

for (const message of ["Hello", "x".repeat(2000)]) {
  test(`valid message (${message.length} characters) returns a labelled demo`, async () => {
    const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.mode, "demo");
    assert.match(data.reply, /no medical analysis has been performed/);
  });
}

for (const message of ["", "   ", 12, null, {}, "x".repeat(2001), undefined]) {
  test(`invalid message: ${typeof message}, length ${message?.length}`, async () => {
    const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_MESSAGE");
  });
}

for (const [body, status, code] of [["{broken", 400, "INVALID_JSON"], [JSON.stringify({ message: "x".repeat(110000) }), 413, "BODY_TOO_LARGE"]]) {
  test(code, async () => {
    const response = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  });
}

test("unknown routes return JSON", async () => {
  const response = await fetch(`${base}/missing`);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "NOT_FOUND");
});
