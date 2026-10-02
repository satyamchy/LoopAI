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
    <section>
      <h1>Connect Agents</h1>
      <p className="lede">Point Cursor or Claude at this workspace. They call the same tools as chat.</p>
      {error && <p className="banner error">{error}</p>}
      {freshKey && <p className="banner">Copy this key now. It will not be shown again. <code>{freshKey}</code></p>}
      <div className="agent-grid">
        {[
          ["Cursor", "Cursor"],
          ["Claude", "Claude"],
        ].map(([name]) => (
          <article key={name} className="panel">
            <h2>{name}</h2>
            <button className="button" type="button" onClick={() => createKey(name).catch((reason: Error) => setError(reason.message))}>
              Create key
            </button>
          </article>
        ))}
        <article className="panel wide">
          <h2>MCP</h2>
          <label>
            URL
            <input readOnly value={mcpUrl} />
          </label>
          <pre>{snippet}</pre>
        </article>
        <article className="panel wide">
          <h2>Call a tool</h2>
          <pre>{`curl -X POST ${mcpUrl.replace(/\/mcp$/, "")}/v1/tools/execute \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "content-type: application/json" \\
  -d "{\\"toolkit\\":\\"echo\\",\\"action\\":\\"echo\\",\\"arguments\\":{\\"message\\":\\"hello\\"}}"`}</pre>
        </article>
      </div>
      {keys.length > 0 && (
        <ul className="key-list">
          {keys.map((key) => (
            <li key={key.id}>{key.name} · {key.keyPrefix}…</li>
          ))}
        </ul>
      )}
    </section>
  );
}
