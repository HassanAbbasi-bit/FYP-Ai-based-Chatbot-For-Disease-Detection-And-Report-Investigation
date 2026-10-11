const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
function readConfig(env = process.env) {
  if (env.NODE_ENV && !["development", "test", "production"].includes(env.NODE_ENV)) throw new Error("NODE_ENV must be development, test, or production.");
  const production = env.NODE_ENV === "production";
  if (!env.MONGODB_URI || !/^mongodb(?:\+srv)?:\/\//.test(env.MONGODB_URI) || /YOUR_|REPLACE_/i.test(env.MONGODB_URI)) throw new Error("Configure MONGODB_URI privately in server/.env.");
  if (!env.SESSION_SECRET || !/^[a-f0-9]{64,}$/i.test(env.SESSION_SECRET)) throw new Error("SESSION_SECRET must be at least 32 random bytes encoded as hexadecimal. Generate it locally.");
  let origin;
  try {
    const url = new URL(env.APP_ORIGIN);
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== env.APP_ORIGIN || (production && url.protocol !== "https:")) throw new Error();
    origin = url.origin;
  } catch { throw new Error("APP_ORIGIN must be an exact origin without a trailing slash; production requires HTTPS."); }
  const port = Number(env.PORT || 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be between 1 and 65535.");
  if (env.TRUST_PROXY && env.TRUST_PROXY !== "loopback") throw new Error("TRUST_PROXY may only be loopback for a verified local reverse proxy, or unset.");
  return { mongoUri: env.MONGODB_URI, sessionSecret: env.SESSION_SECRET, origin, production, trustProxy: env.TRUST_PROXY === "loopback" ? "loopback" : false, port, host: "127.0.0.1", sessionTtlMs: SESSION_TTL_MS, cookieName: production ? "__Host-fyp.sid" : "fyp.sid" };
}
module.exports = { readConfig, SESSION_TTL_MS };
