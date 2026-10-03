import { useEffect, useState } from "react";
import { api } from "../api";

type KeyRow = {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string;
  clientName: string | null;
  clientVersion: string | null;
  lastSeenAt: string | null;
};

export function ConnectAgents() {
  const [name, setName] = useState("");
  const [write, setWrite] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState("0");
  const [mcpUrl, setMcpUrl] = useState("http://localhost:8787/mcp");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    return api<{ keys: KeyRow[]; mcpUrl: string }>("/v1/agent-keys").then((body) => {
      setKeys(body.keys);
      setMcpUrl(body.mcpUrl);
    });
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, []);

  async function createKey() {
    const created = await api<{ key: string; mcpUrl: string }>("/v1/agent-keys", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() || "Agent", write, expiresInDays: Number(expiresInDays) || undefined }),
    });
    setFreshKey(created.key);
    setMcpUrl(created.mcpUrl);
    setCopied(false);
    setName("");
    await load();
  }

  const snippet = JSON.stringify({ mcpServers: { loopai: { url: mcpUrl, headers: { Authorization: `Bearer ${freshKey ?? "YOUR_KEY"}` } } } }, null, 2);
  const connected = keys.filter((key) => key.lastSeenAt);
  const waiting = keys.filter((key) => !key.lastSeenAt);

  return (
    <section className="mx-auto grid max-w-3xl gap-5">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Connect an agent</h1>
        <p className="mt-2 text-stone-500">Tools stay on this MCP server. Any MCP client can use them. The list below is filled when that client connects.</p>
      </header>
      {error && <p className="border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
      <form className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4" onSubmit={(event) => { event.preventDefault(); createKey().catch((reason: Error) => setError(reason.message)); }}>
        <label className="grid gap-1 text-sm">
          Name for this key
          <input className="rounded-none border border-stone-300 px-2.5 py-2" value={name} onChange={(event) => setName(event.target.value)} placeholder="Cursor, Claude, or any other client" minLength={2} />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} />
          Allow send and other writes. This is the approval for this agent.
        </label>
        <label className="grid gap-1 text-sm">
          Expires
          <select className="rounded-none border border-stone-300 px-2.5 py-2" value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)}>
            <option value="0">Until revoke</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </label>
        <button className="w-fit rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white" type="submit">Create key</button>
      </form>
      {freshKey && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm">Copy this key now. It will not be shown again. <code>{freshKey}</code></p>}
      <article className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">MCP config</h2>
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" type="button" onClick={() => navigator.clipboard.writeText(snippet).then(() => setCopied(true)).catch(() => setError("Could not copy."))}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <p className="text-sm text-stone-500">Paste this into the client. A new agent is another key, not a code change. The server URL is {mcpUrl}.</p>
        <pre className="overflow-auto bg-stone-900 p-3 text-sm text-stone-100">{snippet}</pre>
      </article>
      <article className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Connected agents</h2>
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" type="button" onClick={() => load().catch((reason: Error) => setError(reason.message))}>Refresh</button>
        </div>
        {connected.length === 0 && <p className="text-sm text-stone-500">None yet. The name appears here after the client sends its MCP handshake.</p>}
        <ul className="grid gap-2">
          {connected.map((key) => (
            <li key={key.id} className="rounded-md border border-stone-200 px-3 py-2 text-sm">
              <strong>{key.clientName}</strong>
              {key.clientVersion ? <span className="text-stone-500"> {key.clientVersion}</span> : null}
              <span className="block text-stone-500">Key {key.name} · {key.keyPrefix}… · {key.scopes} · last seen {new Date(key.lastSeenAt ?? "").toLocaleString()}</span>
            </li>
          ))}
        </ul>
        {waiting.length > 0 && (
          <>
            <h3 className="mt-2 text-sm font-semibold">Waiting to connect</h3>
            <ul className="grid gap-1 text-sm text-stone-600">
              {waiting.map((key) => <li key={key.id}>{key.name} · {key.keyPrefix}… · {key.scopes}</li>)}
            </ul>
          </>
        )}
      </article>
    </section>
  );
}
