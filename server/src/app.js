const express = require("express");
const session = require("express-session");
const { authRoutes } = require("./routes/auth");
const { userSchema } = require("./models/User");
const { fail, errorHandler } = require("./middleware/errors");
const { checkOrigin, requireAuth } = require("./middleware/security");
const { conversationRoutes } = require("./routes/conversations");
const { reportRoutes } = require("./routes/reports");
const { extractionRoutes } = require("./routes/extractions");

function createApp({ config, connection, store, limits = {}, generation, reports }) {
  if (!store) throw new Error("A MongoDB session store is required.");
  const app = express();
  const User = connection.models.User || connection.model("User", userSchema);
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    next();
  });
  app.get("/api/health", (req, res) => res.json({ status: "ok", service: "express-api", message: "Your Express server is working!" }));
  app.get("/api/ready", async (req, res) => {
    if (connection.readyState !== 1) return fail(res, 503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable.");
    await connection.db.admin().ping({ maxTimeMS: 1000 });
    res.json({ status: "ready" });
  });
  app.use("/api", (req, res, next) => {
    if (connection.readyState !== 1) return fail(res, 503, "SERVICE_UNAVAILABLE", "The service is temporarily unavailable. Please try again later.");
    next();
  });
  app.use(express.json({ limit: "100kb" }));
  const sessions = session({
    name: config.cookieName, secret: config.sessionSecret, store,
    resave: false, saveUninitialized: false, rolling: false,
    cookie: { httpOnly: true, secure: config.production, sameSite: "lax", path: "/", maxAge: config.sessionTtlMs },
  });
  app.use(["/api/auth", "/api/conversations", "/api/reports"], checkOrigin(config.origin), sessions);
  app.use(["/api/auth", "/api/conversations", "/api/reports"], (req, res, next) => {
    // Keep cookie and Mongo expiry tied to the original sign-in time.
    if (req.session.authExpiresAt) req.session.cookie.maxAge = Math.max(0, req.session.authExpiresAt - Date.now());
    next();
  });
  app.use("/api/auth", authRoutes({ User, config, limits }));
  app.use("/api/conversations", requireAuth(User), conversationRoutes({ connection, limits, generation }));
  app.use("/api/reports", requireAuth(User), extractionRoutes(reports, limits), reportRoutes({ reports, limits }));
  app.use((req, res) => fail(res, 404, "NOT_FOUND", "This endpoint does not exist."));
  app.use(errorHandler(connection));
  return app;
}
module.exports = { createApp };
