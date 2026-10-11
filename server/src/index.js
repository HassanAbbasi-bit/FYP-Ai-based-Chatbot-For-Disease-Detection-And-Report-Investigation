const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const mongoose = require("mongoose");
const { MongoStore } = require("connect-mongo");
const { readConfig } = require("./config");
const { createApp } = require("./app");
const { userSchema } = require("./models/User");

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
  let stopping = false;
  async function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    const timeout = setTimeout(() => process.exit(1), 10000);
    timeout.unref();
    try {
      if (server) await new Promise((resolve) => server.close(resolve));
      if (store) await store.close();
      await connection.close();
    } catch { exitCode = 1; }
    clearTimeout(timeout);
    process.exitCode = exitCode;
  }
  try {
    await connection.openUri(config.mongoUri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000, maxPoolSize: 10 });
    await connection.model("User", userSchema).init();
    await connection.db.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    store = MongoStore.create({ client: connection.getClient(), ttl: config.sessionTtlMs / 1000, autoRemove: "native" });
    store.on("error", () => console.error("Session storage is temporarily unavailable."));
    const app = createApp({ config, connection, store });
    server = app.listen(config.port, config.host, () => console.log(`Server running at http://${config.host}:${config.port}`));
    server.on("error", () => { console.error("HTTP server could not start. Check the configured port."); shutdown(1); });
  } catch {
    console.error("Database initialization failed. Check server/.env and MongoDB availability; credentials are never printed.");
    await connection.close().catch(() => {});
    process.exitCode = 1;
    return;
  }
  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());
}
start();
