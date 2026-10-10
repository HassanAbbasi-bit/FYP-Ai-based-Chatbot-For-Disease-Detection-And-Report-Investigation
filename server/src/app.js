const express = require("express");
const { createDemoReply } = require("./services/chat");
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "express-api", message: "Your Express server is working!" });
});

app.post("/api/chat", (req, res) => {
  const message = req.body?.message;
  if (typeof message !== "string" || !message.trim() || message.length > 2000) {
    return res.status(400).json({ error: { code: "INVALID_MESSAGE", message: "Message must be a non-blank string of at most 2,000 characters." } });
  }
  res.json(createDemoReply());
});

app.use((req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "This endpoint does not exist." } });
});

// Never return parser details or request contents to the client.
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "BODY_TOO_LARGE", message: "Request body exceeds the 100 KB limit." } });
  }
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } });
  }
  res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "The server could not process this request." } });
});

module.exports = app;
