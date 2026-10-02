import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type Connection, type ToolkitCard } from "../api";
import { AppLogo } from "../AppLogo";
import { useBase } from "../paths";

export function ConnectApps() {
  const navigate = useNavigate();
  const base = useBase();
  const [params] = useSearchParams();
  const [toolkits, setToolkits] = useState<ToolkitCard[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "connected" | "shared">("all");
  const [error, setError] = useState<string | null>(params.get("error") ? "The app did not connect. Check the OAuth client settings." : null);
  const [notice, setNotice] = useState<string | null>(params.get("connected"));
  const [draft, setDraft] = useState<{ slug: string; name: string; secret: string; shared: boolean } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [mcp, setMcp] = useState({ name: "", url: "", auth: "none" as "none" | "bearer", token: "" });

  async function reload() {
    const catalog = await api<{ toolkits: ToolkitCard[] }>("/v1/toolkits");
    setToolkits(catalog.toolkits);
    try {
      const linked = await api<{ connections: Connection[] }>("/v1/connections");
      setConnections(linked.connections);
    } catch (reason) {
      setConnections([]);
      setError(reason instanceof Error ? reason.message : "Connections could not be loaded.");
    }
  }

  useEffect(() => {
    setQuery(params.get("q") ?? "");
  }, [params]);

  useEffect(() => {
    reload().catch((reason: Error) => setError(reason.message));
  }, []);

  const visible = useMemo(() => {
    return toolkits.filter((toolkit) => {
      const mine = connections.filter((item) => item.toolkitSlug === toolkit.slug);
      if (tab === "connected" && mine.length === 0) return false;
      if (tab === "shared" && !mine.some((item) => item.scope === "workspace")) return false;
      return toolkit.displayName.toLowerCase().includes(query.toLowerCase());
    });
  }, [toolkits, connections, query, tab]);

  async function connect(toolkit: ToolkitCard, scope: "user" | "workspace") {
    setMenu(null);
    setError(null);
    if (toolkit.slug === "custom-mcp") {
      setMcpOpen(true);
      return;
    }
    if (toolkit.authType === "api_key") {
      const singleSecret = toolkit.credentialFields.length === 1 && toolkit.credentialFields[0]?.key === "secret";
      if (!singleSecret) {
        navigate(`${base}/connect/apps/${toolkit.slug}`);
        return;
      }
      setDraft({ slug: toolkit.slug, name: toolkit.displayName, secret: "", shared: scope === "workspace" });
      return;
    }
    const started = await api<{ url: string }>("/v1/connections/start", {
      method: "POST",
      body: JSON.stringify({ toolkit: toolkit.slug, scope }),
    });
    window.location.href = started.url;
  }

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    await api("/v1/connections", {
      method: "POST",
      body: JSON.stringify({ toolkit: draft.slug, secret: draft.secret, scope: draft.shared ? "workspace" : "user" }),
    });
    setDraft(null);
    await reload();
  }

  async function saveMcp(event: FormEvent) {
    event.preventDefault();
    await api("/v1/connections", {
      method: "POST",
      body: JSON.stringify({
        toolkit: "custom-mcp",
        label: mcp.name,
        scope: "user",
        credentials: { serverUrl: mcp.url, ...(mcp.auth === "bearer" ? { bearerToken: mcp.token } : {}) },
      }),
    });
    setMcpOpen(false);
    setMcp({ name: "", url: "", auth: "none", token: "" });
    await reload();
  }

  return (
    <section className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Apps ({toolkits.length})</h1>
        </div>
        <div className="flex gap-2">
          <button className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white" type="button" onClick={() => setMcpOpen(true)}>+ Add Custom MCP</button>
          <button className="rounded-md border border-stone-300 bg-white px-3 py-2 text-sm" type="button" onClick={() => setRequestOpen(true)}>Request App</button>
        </div>
      </header>
      {notice && <p className="mt-4 border border-amber-300 bg-amber-50 px-3 py-2">{notice} connected.</p>}
      {error && <p className="mt-4 border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
      <div className="my-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(["all", "connected", "shared"] as const).map((item) => (
            <button key={item} className={tab === item ? "rounded-md border border-orange-500 px-3 py-2 text-sm text-orange-700" : "rounded-md border border-stone-300 bg-white px-3 py-2 text-sm"} onClick={() => setTab(item)} type="button">
              {item === "all" ? "All" : item === "connected" ? "Connected" : "Shared connections"}
            </button>
          ))}
        </div>
        <input className="rounded-none border border-stone-300 bg-white px-2.5 py-2" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((toolkit) => {
          const mine = connections.filter((item) => item.toolkitSlug === toolkit.slug);
          const active = mine.length > 0;
          const blocked = !toolkit.implemented || (toolkit.authType === "oauth2" && !toolkit.configured);
          return (
            <article key={toolkit.slug} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4" title={toolkit.description}>
              <div className="flex min-w-0 items-center gap-3">
                <AppLogo slug={toolkit.slug} name={toolkit.displayName} />
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold"><Link className="text-inherit no-underline" to={`${base}/connect/apps/${toolkit.slug}`}>{toolkit.displayName}</Link></h2>
                  {blocked && toolkit.setupEnv && <small className="text-stone-500">Set {toolkit.setupEnv}</small>}
                </div>
              </div>
              {toolkit.authType === "none" ? (
                <span className="text-sm font-semibold text-orange-700">Ready</span>
              ) : active ? (
                <div className="relative flex items-center gap-2">
                  <span className="text-sm font-semibold text-green-700">✓ {mine.length} Active</span>
                  <button className="rounded-md border border-orange-500 px-2 py-1 text-sm text-orange-700" type="button" disabled={blocked} onClick={() => connect(toolkit, "user").catch((reason: Error) => setError(reason.message))}>+ New</button>
                </div>
              ) : (
                <div className="relative">
                  <div className="flex">
                    <button className="rounded-l-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:bg-stone-300" type="button" disabled={blocked} title={toolkit.setupEnv ? `Set ${toolkit.setupEnv}` : undefined} onClick={() => connect(toolkit, "user").catch((reason: Error) => setError(reason.message))}>Connect</button>
                    <button className="rounded-r-md border-l border-orange-800 bg-orange-500 px-2 text-white disabled:bg-stone-300" type="button" disabled={blocked} aria-label={`Connect options for ${toolkit.displayName}`} onClick={() => setMenu(menu === toolkit.slug ? null : toolkit.slug)}>▾</button>
                  </div>
                  {menu === toolkit.slug && (
                    <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-stone-200 bg-white p-1 text-sm shadow-none">
                      <button className="block w-full px-2 py-2 text-left" type="button" onClick={() => connect(toolkit, "user").catch((reason: Error) => setError(reason.message))}>Private to you</button>
                      <button className="block w-full px-2 py-2 text-left" type="button" onClick={() => connect(toolkit, "workspace").catch((reason: Error) => setError(reason.message))}>Shared with workspace</button>
                      {toolkit.setupEnv && <p className="px-2 py-2 text-stone-500">Set {toolkit.setupEnv}. Redirect {toolkit.slug === "canva" ? "http://127.0.0.1:8787/v1/oauth/callback" : "http://localhost:8787/v1/oauth/callback"}.</p>}
                    </div>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
      {visible.length === 0 && <p className="text-stone-500">No apps match that search.</p>}
      {draft && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
          <form className="grid w-full max-w-md gap-3 bg-white p-5" onSubmit={(event) => saveKey(event).catch((reason: Error) => setError(reason.message))}>
            <h2 className="text-lg font-semibold">Connect {draft.name}</h2>
            <label className="grid gap-1 text-sm">
              Secret
              <input className="rounded-none border border-stone-300 px-2.5 py-2" type="password" value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} required minLength={8} />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={draft.shared} onChange={(event) => setDraft({ ...draft, shared: event.target.checked })} />
              Shared with workspace
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-md border border-stone-300 px-3 py-2" onClick={() => setDraft(null)}>Cancel</button>
              <button className="rounded-md bg-orange-500 px-3 py-2 font-semibold text-white" type="submit">Save connection</button>
            </div>
          </form>
        </div>
      )}
      {mcpOpen && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/60 p-4">
          <form className="grid w-full max-w-md gap-3 bg-zinc-900 p-5 text-zinc-100" onSubmit={(event) => saveMcp(event).catch((reason: Error) => setError(reason.message))}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Add Custom MCP <span className="ml-2 text-xs font-medium text-zinc-400">Beta, MCP only</span></h2>
                <p className="mt-1 text-sm text-zinc-400">Create a toolkit from a remote MCP server.</p>
              </div>
              <button className="text-zinc-400" type="button" onClick={() => setMcpOpen(false)} aria-label="Close">×</button>
            </div>
            <label className="grid gap-1 text-sm">
              Display name
              <input className="rounded-none border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-white" value={mcp.name} onChange={(event) => setMcp({ ...mcp, name: event.target.value })} required />
            </label>
            <label className="grid gap-1 text-sm">
              MCP server URL
              <input className="rounded-none border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-white" type="url" placeholder="https://mcp.example.com/mcp" value={mcp.url} onChange={(event) => setMcp({ ...mcp, url: event.target.value })} required />
            </label>
            <label className="grid gap-1 text-sm">
              Authentication
              <select className="rounded-none border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-white" value={mcp.auth} onChange={(event) => setMcp({ ...mcp, auth: event.target.value as "none" | "bearer" })}>
                <option value="none">None</option>
                <option value="bearer">Bearer token</option>
              </select>
            </label>
            {mcp.auth === "bearer" && (
              <label className="grid gap-1 text-sm">
                Bearer token
                <input className="rounded-none border border-zinc-700 bg-zinc-800 px-2.5 py-2 text-white" type="password" value={mcp.token} minLength={8} required onChange={(event) => setMcp({ ...mcp, token: event.target.value })} />
              </label>
            )}
            <div className="flex justify-end gap-2">
              <button className="rounded-md px-3 py-2 text-zinc-300" type="button" onClick={() => setMcpOpen(false)}>Cancel</button>
              <button className="rounded-md bg-white px-3 py-2 font-semibold text-zinc-900" type="submit">Add</button>
            </div>
          </form>
        </div>
      )}
      {requestOpen && (
        <div className="fixed inset-0 z-20 grid place-items-center bg-black/40 p-4">
          <div className="grid w-full max-w-md gap-3 bg-white p-5">
            <h2 className="text-lg font-semibold">Request an app</h2>
            <p className="text-sm text-stone-600">Notion, HubSpot, and Linear are listed and not built yet. A request is not stored.</p>
            <button className="justify-self-end rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white" type="button" onClick={() => setRequestOpen(false)}>Close</button>
          </div>
        </div>
      )}
    </section>
  );
}
