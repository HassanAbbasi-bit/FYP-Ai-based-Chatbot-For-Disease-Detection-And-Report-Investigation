// Temporary browser-test server: never loads .env and never touches a configured user database.
const { isolatedServer } = require("../test-support/database");
(async () => {
  const fixture = await isolatedServer({ port: 5000 });
  console.log("Isolated browser-test server ready at http://127.0.0.1:5000 (temporary MongoDB, no user credentials).");
  let closing = false;
  async function close() { if (closing) return; closing = true; await fixture.close(); }
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
})().catch(() => { console.error("Isolated browser-test server could not start."); process.exitCode = 1; });
