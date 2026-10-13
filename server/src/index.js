const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const { MongoStore } = require("connect-mongo");
const { readConfig } = require("./config");
const { createApp } = require("./app");
const { userSchema } = require("./models/User");
const { initializeConversations } = require("./models/Conversation");
const { createReportService } = require("./services/reports");
const { startupError } = require("./services/startup-error");

async function start() {
  let config;
  try { config = readConfig(); } catch (error) {
    console.error(error.message); // Authored configuration messages contain no URI values.
    process.exitCode = 1;
    return;
  }
  const connection = mongoose.createConnection();
  let store;
  let server;
  let reports;
  let stopping = false;
  let stage = "database";
  async function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (reports) await reports.close();
      if (store) await store.close();
      await connection.close();
    } catch { exitCode = 1; }
    clearTimeout(timeout);
    process.exitCode = exitCode;
  }
  try {
    await connection.openUri(config.mongoUri, { serverSelectionTimeoutMS: 30000, connectTimeoutMS: 15000, socketTimeoutMS: 30000, maxPoolSize: 10 });
    await connection.model("User", userSchema).init();
    await initializeConversations(connection);
    reports = await createReportService({ connection, config });
    await reports.cleanup();
    await connection.db.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    // The TTL index was awaited above; avoid a second asynchronous index creation.
    store = MongoStore.create({ client: connection.getClient(), dbName: connection.name, ttl: config.sessionTtlMs / 1000, autoRemove: "disabled" });
    store.on("error", () => console.error("Session storage is temporarily unavailable."));
    const app = createApp({ config, connection, store, reports });
    stage = "http";
    server = app.listen(config.port, config.host);
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    console.log(`Server running at http://${config.host}:${config.port}`);
    server.on("error", () => { console.error("HTTP server could not start. Check the configured port."); shutdown(1); });
  } catch (error) {
    console.error(startupError(error, stage, config.port));
    await shutdown(1);
    return;
  }
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
}
start();
