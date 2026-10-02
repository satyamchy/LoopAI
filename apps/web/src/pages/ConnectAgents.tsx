import { useEffect, useState } from "react";
import { api } from "../api";

type KeyRow = { id: string; name: string; keyPrefix: string; createdAt: string };

export function ConnectAgents() {
  const [mcpUrl, setMcpUrl] = useState("http://localhost:8787/mcp");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ keys: KeyRow[]; mcpUrl: string }>("/v1/agent-keys")
      .then((body) => {
        setKeys(body.keys);
        setMcpUrl(body.mcpUrl);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function createKey(name: string) {
    const created = await api<{ key: string; mcpUrl: string }>("/v1/agent-keys", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    setFreshKey(created.key);
    setMcpUrl(created.mcpUrl);
    const listed = await api<{ keys: KeyRow[] }>("/v1/agent-keys");
    setKeys(listed.keys);
  }

  const snippet = JSON.stringify({ mcpServers: { loopai: { url: mcpUrl, headers: { Authorization: `Bearer ${freshKey ?? "YOUR_KEY"}` } } } }, null, 2);

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Agents</h1>
          <p>Cursor and Claude call the same tools as chat. The key is shown once.</p>
        </div>
      </header>
      {error && <p className="banner error">{error}</p>}
      {freshKey && <p className="banner">Copy this key now. It will not be shown again. <code>{freshKey}</code></p>}
      <div className="steps">
        <article className="panel step">
          <div className="step-head">
            <span className="step-no">1</span>
            <h2>Create a key</h2>
          </div>
          <div className="step-actions">
            {["Cursor", "Claude"].map((name) => (
              <button key={name} className="button" type="button" onClick={() => createKey(name).catch((reason: Error) => setError(reason.message))}>
                Create {name} key
              </button>
            ))}
          </div>
          {keys.length > 0 ? (
            <ul className="key-list">
              {keys.map((key) => (
                <li key={key.id}>{key.name} · {key.keyPrefix}…</li>
              ))}
            </ul>
          ) : (
            <p className="empty">No keys yet.</p>
          )}
        </article>
        <article className="panel step">
          <div className="step-head">
            <span className="step-no">2</span>
            <h2>Paste this into the agent</h2>
          </div>
          <label>
            MCP URL
            <input readOnly value={mcpUrl} />
          </label>
          <pre>{snippet}</pre>
        </article>
        <article className="panel step">
          <div className="step-head">
            <span className="step-no">3</span>
            <h2>Or call a tool over HTTP</h2>
          </div>
          <pre>{`curl -X POST ${mcpUrl.replace(/\/mcp$/, "")}/v1/tools/execute \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "content-type: application/json" \\
  -d "{\\"toolkit\\":\\"echo\\",\\"action\\":\\"echo\\",\\"arguments\\":{\\"message\\":\\"hello\\"}}"`}</pre>
        </article>
      </div>
    </section>
  );
}
