import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useBase } from "../paths";

type KeyRow = { id: string; name: string; keyPrefix: string; createdAt: string };

const clients = [
  { name: "Cursor", detail: "Add an MCP server in Cursor settings with this URL and bearer key." },
  { name: "Claude", detail: "Use the same URL and bearer key in Claude desktop." },
  { name: "ChatGPT", detail: "Add this URL and bearer key in the ChatGPT app on this computer. The ChatGPT website cannot reach localhost." },
];

export function ConnectAgents() {
  const navigate = useNavigate();
  const base = useBase();
  const { client: clientParam } = useParams();
  const client = clients.find((item) => item.name.toLowerCase() === clientParam)?.name ?? "ChatGPT";
  const [name, setName] = useState(client);
  const [mcpUrl, setMcpUrl] = useState("http://localhost:8787/mcp");
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(client);
  }, [client]);

  useEffect(() => {
    api<{ keys: KeyRow[]; mcpUrl: string }>("/v1/agent-keys")
      .then((body) => {
        setKeys(body.keys);
        setMcpUrl(body.mcpUrl);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  async function createKey() {
    const created = await api<{ key: string; mcpUrl: string }>("/v1/agent-keys", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() || client }),
    });
    setFreshKey(created.key);
    setMcpUrl(created.mcpUrl);
    setCopied(false);
    const listed = await api<{ keys: KeyRow[] }>("/v1/agent-keys");
    setKeys(listed.keys);
  }

  const snippet = JSON.stringify({ mcpServers: { loopai: { url: mcpUrl, headers: { Authorization: `Bearer ${freshKey ?? "YOUR_KEY"}` } } } }, null, 2);
  const cli = `claude mcp add --transport http loopai ${mcpUrl} --header "Authorization: Bearer ${freshKey ?? "YOUR_KEY"}"`;

  return (
    <section className="mx-auto grid max-w-3xl gap-5">
      <header className="text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Connect an agent</h1>
        <p className="mt-2 text-stone-500">Create a key, copy the MCP block once, and paste it into the client.</p>
      </header>
      {error && <p className="border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        {clients.map((item) => (
          <button key={item.name} type="button" className={client === item.name ? "rounded-lg border border-orange-500 bg-orange-50 p-4 text-left" : "rounded-lg border border-stone-200 bg-white p-4 text-left"} onClick={() => navigate(`${base}/connect/clients/${item.name.toLowerCase()}`)}>
            <h2 className="text-base font-semibold">{item.name}</h2>
            <p className="mt-1 text-sm text-stone-500">{item.detail}</p>
          </button>
        ))}
      </div>
      <form className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4" onSubmit={(event) => { event.preventDefault(); createKey().catch((reason: Error) => setError(reason.message)); }}>
        <label className="grid gap-1 text-sm">
          Key name
          <input className="rounded-none border border-stone-300 px-2.5 py-2" value={name} onChange={(event) => setName(event.target.value)} required minLength={2} />
        </label>
        <button className="w-fit rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white" type="submit">Create key</button>
      </form>
      {freshKey && <p className="border border-amber-300 bg-amber-50 px-3 py-2 text-sm">Copy this key now. It will not be shown again. <code>{freshKey}</code></p>}
      <article className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">MCP config</h2>
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" type="button" onClick={() => navigator.clipboard.writeText(snippet).then(() => setCopied(true)).catch(() => setError("Could not copy."))}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <pre className="overflow-auto bg-stone-900 p-3 text-sm text-stone-100">{snippet}</pre>
        <h3 className="text-sm font-semibold">CLI</h3>
        <p className="text-sm text-stone-500">This works only while the API is running on this computer.</p>
        <pre className="overflow-auto bg-stone-900 p-3 text-sm text-stone-100">{cli}</pre>
      </article>
      {keys.length > 0 && (
        <ul className="grid gap-1 text-sm text-stone-600">
          {keys.map((key) => <li key={key.id}>{key.name} · {key.keyPrefix}…</li>)}
        </ul>
      )}
    </section>
  );
}
