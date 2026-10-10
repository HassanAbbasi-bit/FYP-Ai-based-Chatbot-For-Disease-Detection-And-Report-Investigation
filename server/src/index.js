const app = require("./app");
const PORT = 5000;
const HOST = "127.0.0.1";

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
