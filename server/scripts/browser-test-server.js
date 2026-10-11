// Temporary browser-test server: never loads .env and never touches a configured user database.
const { isolatedServer } = require("../test-support/database");
const { createAdapter } = require("../src/services/extraction-adapters");
const { ReportError } = require("../src/services/report-errors");
(async () => {
  const port = Number(process.env.BROWSER_TEST_PORT || 5000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid test port");
  let failOnce = process.env.BROWSER_TEST_EXTRACTION_FAIL_ONCE === "true";
  const fixture = await isolatedServer({ port, origin: process.env.BROWSER_TEST_ORIGIN || "http://localhost:5173", reportConfig: { extractionDemoEnabled: process.env.EXTRACTION_DEMO_ENABLED === "true" }, extractionAutoRun: true,
    extractionAdapter: async (args) => { if (failOnce) { failOnce = false; throw new ReportError(503, "SYNTHETIC_TEST_FAILURE", "Synthetic browser test failure. Retry this demo attempt."); } return createAdapter(fixture.config, fixture.reports.storage)(args); } });
  console.log(`Isolated browser-test server ready at http://127.0.0.1:${port} (temporary MongoDB and private storage, no user credentials).`);
  let closing = false;
  async function close() { if (closing) return; closing = true; await fixture.close(); }
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
})().catch((error) => { console.error(error.code === 'EADDRINUSE' ? 'Isolated browser-test port is occupied.' : error.code === 14031 ? 'Isolated test database needs more temporary disk space.' : 'Isolated browser-test server could not start.'); process.exitCode = 1; });
