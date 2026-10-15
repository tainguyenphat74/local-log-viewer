import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api, Client } from "./client";
import "./style.css";
import { Workspace } from "./Workspace";
export function App() {
  const [csrf, setCsrf] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [agents, setAgents] = useState<any[]>([]),
    [agentId, setAgent] = useState(""),
    [online, setOnline] = useState(false),
    [client, setClient] = useState<Client>(),
    [code, setCode] = useState("");
  useEffect(() => {
    api("/session")
      .then((v) => setCsrf(v.csrf))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (!csrf) return;
    const c = new Client(setOnline);
    setClient(c);
    const refresh = () =>
      api("/agents")
        .then(setAgents)
        .catch(() => setCsrf(""));
    refresh();
    const t = setInterval(refresh, 2000);
    return () => {
      clearInterval(t);
      c.close();
    };
  }, [csrf]);
  useEffect(() => {
    if (!agentId && agents.length) setAgent(agents[0].id);
  }, [agents, agentId]);
  async function login(e: React.FormEvent) {
    e.preventDefault();
    try {
      setCsrf((await api("/login", "POST", { password })).csrf);
      setPassword("");
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }
  if (!csrf)
    return (
      <main className="login">
        <div className="brand">▤ Local Log Viewer</div>
        <h1>Your logs. In view.</h1>
        <p>Sign in to connect to your locally approved log folders.</p>
        <form onSubmit={login}>
          <label>
            Gateway password
            <input
              autoFocus
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary">Sign in</button>
        </form>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  return (
    <div className="app">
      <header>
        <div className="brand">▤ Local Log Viewer</div>
        <span className="connection">
          {online ? "● Connected" : "○ Reconnecting"}
        </span>
        <select
          aria-label="Agent"
          value={agentId}
          onChange={(e) => setAgent(e.target.value)}
        >
          <option value="">Select agent</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.online ? "online" : "offline"}
            </option>
          ))}
        </select>
        <button
          onClick={async () => {
            try {
              setCode((await api("/pairings", "POST", {}, csrf)).code);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          Pair agent
        </button>
        <button
          disabled={!agentId}
          onClick={async () => {
            if (confirm("Revoke this agent’s access?")) {
              await api("/agents/" + agentId, "DELETE", undefined, csrf);
              setAgent("");
            }
          }}
        >
          Revoke
        </button>
        <button
          onClick={async () => {
            await api("/logout", "POST", {}, csrf);
            setCsrf("");
          }}
        >
          Sign out
        </button>
      </header>
      {code && (
        <section className="pair">
          <strong>Pair from your local terminal · expires in 2 minutes</strong>
          <code>
            LOGVIEW_PAIR_CODE='{code}' pnpm agent pair {location.origin}
          </code>
          <p>
            This grants gateway access to roots you approve locally. The gateway
            can read relayed logs.
          </p>
          <button onClick={() => setCode("")}>Dismiss</button>
        </section>
      )}
      {error && (
        <div role="alert" className="error" onClick={() => setError("")}>
          {error} ×
        </div>
      )}
      {client && agentId ? (
        <Workspace key={agentId} {...{ client, agentId, online }} />
      ) : (
        <section className="empty">
          <h1>Connect your workspace</h1>
          <p>
            Approve folders with{" "}
            <code>pnpm agent roots add &lt;directory&gt;</code>, pair your
            agent, then run <code>pnpm agent start</code>.
          </p>
          <p>Your computer accepts no inbound connections.</p>
        </section>
      )}
      <footer>
        Local files · secure outbound agent · single-user workspace
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
