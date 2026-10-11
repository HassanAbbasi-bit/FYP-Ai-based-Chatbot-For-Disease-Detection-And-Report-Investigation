// This helper always owns a temporary MongoDB process. It never reads .env or TEST/MONGODB_URI.
const { MongoMemoryServer } = require("mongodb-memory-server");
const mongoose = require("mongoose");
const { MongoStore } = require("connect-mongo");
const { randomBytes } = require("node:crypto");
const { createApp } = require("../src/app");
const { readConfig } = require("../src/config");
const { userSchema } = require("../src/models/User");

async function isolatedServer({ port = 0, limits = { register: 1000, login: 1000, chat: 1000, csrf: 1000 } } = {}) {
  let mongo;
  let connection;
  let store;
  let server;
  async function close() {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (store) await store.close();
    if (connection) await connection.close();
    if (mongo) await mongo.stop();
  }
  try {
    mongo = await MongoMemoryServer.create({ instance: { ip: "127.0.0.1" } });
    const config = readConfig({ MONGODB_URI: mongo.getUri("fyp_auth_isolated"), SESSION_SECRET: randomBytes(32).toString("hex"), APP_ORIGIN: "http://localhost:5173" });
    connection = await mongoose.createConnection(config.mongoUri, { serverSelectionTimeoutMS: 1500, connectTimeoutMS: 1500, heartbeatFrequencyMS: 500 }).asPromise();
    const User = connection.model("User", userSchema);
    await User.init();
    await connection.db.collection("sessions").createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    store = MongoStore.create({ client: connection.getClient(), ttl: config.sessionTtlMs / 1000, autoRemove: "native" });
    store.on("error", () => {}); // Errors are asserted through HTTP; never log payloads.
    const app = createApp({ config, connection, store, limits });
    server = app.listen(port, "127.0.0.1");
    await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    return { config, connection, store, User, mongo, base: `http://127.0.0.1:${server.address().port}`, close };
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
