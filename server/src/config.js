const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const path = require("node:path");
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
  function bounded(name, fallback, max) {
    const value = env[name] === undefined ? fallback : Number(env[name]);
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} must be a positive integer no greater than ${max}.`);
    return value;
  }
  const reportStorageDir = path.resolve(env.REPORT_STORAGE_DIR || path.join(__dirname, "../private-reports"));
  const clientRoot = path.resolve(__dirname, "../../client");
  if (reportStorageDir === clientRoot || reportStorageDir.startsWith(clientRoot + path.sep)) throw new Error("REPORT_STORAGE_DIR must be outside client/ and publicly served directories.");
  const reportMaxBytes = bounded("REPORT_MAX_BYTES", 10 * 1024 * 1024, 25 * 1024 * 1024);
  const reportMaxTotalBytes = bounded("REPORT_MAX_TOTAL_BYTES", 100 * 1024 * 1024, 1024 * 1024 * 1024);
  if (reportMaxTotalBytes < reportMaxBytes) throw new Error("REPORT_MAX_TOTAL_BYTES must be at least REPORT_MAX_BYTES.");
  const extractionProvider = env.EXTRACTION_PROVIDER || "off";
  const chatProvider = env.CHAT_PROVIDER || (production ? 'off' : 'demo');
  if (!['off','demo','fastapi'].includes(chatProvider)) throw new Error('CHAT_PROVIDER must be off, demo or fastapi.');
  if(production&&chatProvider==='demo')throw new Error('Demo chat is disabled in production; configure fastapi or off.');
  if (!["off", "fastapi"].includes(extractionProvider)) throw new Error("EXTRACTION_PROVIDER must be off or fastapi.");
  const extractionDemoEnabled = env.EXTRACTION_DEMO_ENABLED === "true";
  if (env.EXTRACTION_DEMO_ENABLED && !["true", "false"].includes(env.EXTRACTION_DEMO_ENABLED)) throw new Error("EXTRACTION_DEMO_ENABLED must be true or false.");
  if (production && extractionDemoEnabled) throw new Error("Synthetic demo extraction is disabled in production.");
  let aiServiceUrl;
  if (extractionProvider === "fastapi" || chatProvider === "fastapi") {
    try { const u = new URL(env.AI_SERVICE_URL); if (!["http:", "https:"].includes(u.protocol) || u.username || u.password || u.origin !== env.AI_SERVICE_URL) throw new Error(); aiServiceUrl = u.origin; }
    catch { throw new Error("Configure AI_SERVICE_URL as an exact HTTP(S) origin for the supplied service."); }
    if (!env.AI_INTERNAL_KEY || env.AI_INTERNAL_KEY.length > 256 || /[\r\n]/.test(env.AI_INTERNAL_KEY)) throw new Error("Configure AI_INTERNAL_KEY privately for extraction.");
  }
  return { mongoUri: env.MONGODB_URI, sessionSecret: env.SESSION_SECRET, origin, production, trustProxy: env.TRUST_PROXY === "loopback" ? "loopback" : false, port, host: "127.0.0.1", sessionTtlMs: SESSION_TTL_MS, cookieName: production ? "__Host-fyp.sid" : "fyp.sid",
    reportStorageDir, reportMaxBytes, reportMaxTotalBytes, reportMaxCount: bounded("REPORT_MAX_COUNT", 20, 1000), reportMaxPixels: bounded("REPORT_MAX_PIXELS", 20_000_000, 40_000_000),
    exportFontPath: env.EXPORT_FONT_PATH || (process.platform === 'win32' ? 'C:\\Windows\\Fonts\\arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'),
    extractionProvider, chatProvider, extractionDemoEnabled, aiServiceUrl, aiInternalKey: env.AI_INTERNAL_KEY, extractionTimeoutMs: bounded("EXTRACTION_TIMEOUT_MS", 125000, 130000) };
}
module.exports = { readConfig, SESSION_TTL_MS };
