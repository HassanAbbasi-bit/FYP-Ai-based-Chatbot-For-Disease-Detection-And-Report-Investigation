import { useState } from "react";
import "./App.css";

function App() {
  const [status, setStatus] = useState("Not checked yet");
  const [message, setMessage] = useState("");
  const [isChecking, setIsChecking] = useState(false);

  async function checkConnection() {
    setIsChecking(true);
    setStatus("Checking...");
    setMessage("");

    try {
      const response = await fetch("/api/health", {
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error("Server returned an error.");
      }

      const data = await response.json();

      if (
        data.status !== "ok" ||
        data.service !== "express-api" ||
        typeof data.message !== "string"
      ) {
        throw new Error("Unexpected server response.");
      }

      setStatus("Connected");
      setMessage(data.message);
    } catch {
      setStatus("Connection failed");
      setMessage(
        "Make sure Express is running in FYP/server, then try again."
      );
    } finally {
      setIsChecking(false);
    }
  }

  return (
    <main className="page">
      <section className="connection-card">
        <p className="eyebrow">FYP · DEVELOPMENT</p>
        <h1>AI Health Assistant</h1>
        <p className="intro">
          Check the connection between your React interface and Express
          server.
        </p>

        <div className="status-box" role="status" aria-live="polite">
          <strong>{status}</strong>
          {message && <p>{message}</p>}
        </div>

        <button onClick={checkConnection} disabled={isChecking}>
          {isChecking ? "Checking..." : "Check server connection"}
        </button>
      </section>
    </main>
  );
}

export default App;