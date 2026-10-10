const express = require("express");

const app = express();
const PORT = 5000;
const HOST = "127.0.0.1";

app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    service: "express-api",
    message: "Your Express server is working!",
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "This endpoint does not exist.",
    },
  });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
  console.log(`Health check: http://${HOST}:${PORT}/api/health`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already being used.`);
  } else {
    console.error("Server could not start:", error.code);
  }

  process.exit(1);
});