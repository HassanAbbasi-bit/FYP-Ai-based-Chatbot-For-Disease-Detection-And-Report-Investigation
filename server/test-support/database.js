// This helper always owns a temporary MongoDB process. It never reads .env or TEST/MONGODB_URI.
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { MongoStore } = require("connect-mongo");
const { randomBytes } = require("node:crypto");
const { createApp } = require("../src/app");
const { readConfig } = require("../src/config");
const { userSchema } = require("../src/models/User");
const { initializeConversations, conversationModels } = require("../src/models/Conversation");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createReportService } = require("../src/services/reports");

async function isolatedServer({ port = 0, limits = { register: 1000, login: 1000, chat: 1000, csrf: 1000, create: 1000, history: 10000, upload: 1000, reports: 10000, download: 1000, extractionReads: 10000, extractionWrites: 1000, extractionStarts: 1000 }, generation, reportConfig = {}, reportHooks, extractionAdapter, extractionAutoRun = false, databaseTimeoutMs = 1500, origin = "http://localhost:5173" } = {}) {
  let mongo;
  let connection;
  let store;
  let server;
  let testRoot;
  let reports;
  async function close() {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (reports) await reports.close();
    if (store) await store.close();
    if (connection) await connection.close();
    if (mongo) await mongo.stop();
    if (testRoot) {
      const resolved = path.resolve(testRoot);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith("fyp-reports-test-")) throw new Error("Unsafe test cleanup target");
      await fs.rm(resolved, { recursive: true, force: true });
    }
  }
  try {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger", ip: "127.0.0.1" } });
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "fyp-reports-test-"));
    const config = { ...readConfig({ MONGODB_URI: mongo.getUri("fyp_auth_isolated"), SESSION_SECRET: randomBytes(32).toString("hex"), APP_ORIGIN: origin, REPORT_STORAGE_DIR: testRoot }), ...reportConfig, reportStorageDir: testRoot };
    connection = await mongoose.createConnection(config.mongoUri, { serverSelectionTimeoutMS: databaseTimeoutMs, connectTimeoutMS: databaseTimeoutMs, heartbeatFrequencyMS: 500 }).asPromise();
    const User = connection.model("User", userSchema);
    await User.init();
    await initializeConversations(connection);
    reports = await createReportService({ connection, config, hooks: reportHooks, extractionAdapter, extractionAutoRun });
    await connection.db.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    store = MongoStore.create({ client: connection.getClient(), dbName: connection.name, ttl: config.sessionTtlMs / 1000, autoRemove: "disabled" });
    store.on("error", () => {}); // Errors are asserted through HTTP; never log payloads.
    const app = createApp({ config, connection, store, limits, generation, reports });
    server = app.listen(port, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    return { config, connection, store, User, ...conversationModels(connection), reports, Report: reports.Report, mongo, base: `http://127.0.0.1:${server.address().port}`, close };
  } catch (error) {
    await close();
    throw error;
  }
}

function client(fixture) {
  let cookie = "";
  let token;
  return {
    get cookie() { return cookie; },
    get token() { return token; },
    async request(path, { method = "GET", body, raw, csrf = true, origin = fixture.config.origin, savedCookie } = {}) {
      const headers = { Cookie: savedCookie === undefined ? cookie : savedCookie };
      if (method !== "GET") {
        headers.Origin = origin;
        headers["Content-Type"] = "application/json";
        if (csrf && token) headers["x-csrf-token"] = typeof csrf === "string" ? csrf : token;
      }
      const response = await fetch(`${fixture.base}${path}`, { method, headers, body: raw === undefined ? body === undefined ? undefined : JSON.stringify(body) : raw });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const data = await response.json();
      if (data.csrfToken) token = data.csrfToken;
      return { response, data, status: response.status, setCookie };
    },
    async bootstrap() { return this.request("/api/auth/csrf"); },
  };
}
module.exports = { isolatedServer, client };
