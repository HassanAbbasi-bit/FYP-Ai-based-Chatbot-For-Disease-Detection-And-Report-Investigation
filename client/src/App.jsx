import { useEffect, useRef, useState } from "react";
import { api, clearCsrf } from "./api/client";
import AuthScreen from "./screens/AuthScreen";
import Chat from "./screens/Chat";
import "./App.css";

export default function App() {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const logoutBusy = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    async function restore() {
      try {
        const data = await api("/auth/me", { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
        if (!controller.signal.aborted) setUser(data.user);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error.status === 401) setUser(null);
        else setRestoreError(error.message);
      } finally {
        if (!controller.signal.aborted) setRestoring(false);
      }
    }
    restore();
    return () => controller.abort();
  }, [attempt]);

  function expired() {
    clearCsrf();
    setUser(null);
    setNotice("Your session expired. Sign in again to continue.");
    setLogoutError("");
  }
  async function logout() {
    if (logoutBusy.current) return;
    logoutBusy.current = true;
    setLoggingOut(true);
    setLogoutError("");
    try {
      await api("/auth/logout", { method: "POST" });
      clearCsrf();
      setUser(null); // Unmounting Chat clears all in-memory messages and drafts.
      setNotice("You are signed out. The previous conversation has been cleared.");
    } catch (error) {
      setLogoutError(`Could not confirm sign-out. ${error.message}`);
    } finally {
      logoutBusy.current = false;
      setLoggingOut(false);
    }
  }
  return (
    <main className="page">
      {restoring ? <section className="chat-panel" role="status">Restoring your session...</section>
        : restoreError ? <section className="chat-panel"><h1>Connection unavailable</h1><p role="alert">{restoreError}</p><p>This does not mean your session expired.</p><button onClick={() => { setRestoreError(""); setRestoring(true); setAttempt((value) => value + 1); }}>Retry session check</button></section>
          : user ? <Chat key={user.id} user={user} onExpired={expired} onLogout={logout} loggingOut={loggingOut} logoutError={logoutError} />
            : <AuthScreen notice={notice} onSignedIn={(signedIn) => { setUser(signedIn); setNotice(""); setLogoutError(""); }} />}
    </main>
  );
}
