import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type Connection, type ToolkitCard } from "../api";

export function ConnectApps() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [toolkits, setToolkits] = useState<ToolkitCard[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<"all" | "connected" | "shared">("all");
  const [error, setError] = useState<string | null>(params.get("error") ? "The app did not connect. Check the OAuth client settings." : null);
  const [notice, setNotice] = useState<string | null>(params.get("connected"));
  const [draft, setDraft] = useState<{ slug: string; name: string; secret: string; shared: boolean } | null>(null);
  const [echoMessage, setEchoMessage] = useState("hello");
  const [echoResult, setEchoResult] = useState<string | null>(null);

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

  async function connect(toolkit: ToolkitCard) {
    setError(null);
    if (toolkit.authType === "api_key") {
      const singleSecret = toolkit.credentialFields.length === 1 && toolkit.credentialFields[0]?.key === "secret";
      if (!singleSecret) {
        navigate(`/connect/apps/${toolkit.slug}`);
        return;
      }
      setDraft({ slug: toolkit.slug, name: toolkit.displayName, secret: "", shared: false });
      return;
    }
    const started = await api<{ url: string }>("/v1/connections/start", {
      method: "POST",
      body: JSON.stringify({ toolkit: toolkit.slug, scope: "user" }),
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

  async function runEcho(accountId: string) {
    const result = await api<{ result: unknown }>("/v1/tools/execute", {
      method: "POST",
      body: JSON.stringify({ toolkit: "echo", action: "echo", arguments: { message: echoMessage }, connectedAccountId: accountId }),
    });
    setEchoResult(JSON.stringify(result.result));
  }

  const groups = [
    { id: "connected", title: "Connected", items: visible.filter((toolkit) => connections.some((item) => item.toolkitSlug === toolkit.slug)) },
    {
      id: "ready",
      title: "Ready to connect",
      items: visible.filter((toolkit) => {
        const linked = connections.some((item) => item.toolkitSlug === toolkit.slug);
        const needsSetup = !toolkit.implemented || (toolkit.authType === "oauth2" && !toolkit.configured);
        return !linked && !needsSetup;
      }),
    },
    {
      id: "setup",
      title: "Needs setup",
      items: visible.filter((toolkit) => {
        const linked = connections.some((item) => item.toolkitSlug === toolkit.slug);
        return !linked && (!toolkit.implemented || (toolkit.authType === "oauth2" && !toolkit.configured));
      }),
    },
  ];

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h1>Apps</h1>
          <p>{toolkits.length} available</p>
        </div>
        <Link className="button" to="/connect/agents">Add Custom MCP</Link>
      </header>
      {notice && <p className="banner">{notice} connected.</p>}
      {error && <p className="banner error">{error}</p>}
      <div className="toolbar">
        <div className="tabs">
          {(["all", "connected", "shared"] as const).map((item) => (
            <button key={item} className={tab === item ? "tab active" : "tab"} onClick={() => setTab(item)} type="button">
              {item === "all" ? "All" : item === "connected" ? "Connected" : "Shared connections"}
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <section key={group.id} className="app-section">
            <h2>{group.title} <span className="section-count">{group.items.length}</span></h2>
            <div className="grid">
              {group.items.map((toolkit) => {
                const mine = connections.filter((item) => item.toolkitSlug === toolkit.slug);
                const active = mine.length > 0;
                return (
                  <article key={toolkit.slug} className="card" title={toolkit.description}>
                    <div className="card-main">
                      <span className="app-mark">{toolkit.displayName.slice(0, 1)}</span>
                      <div>
                        <h2><Link to={`/connect/apps/${toolkit.slug}`}>{toolkit.displayName}</Link></h2>
                        <small>{active ? mine[0].externalLabel ?? `${mine.length} connected` : toolkit.authType === "none" ? "No account needed" : toolkit.implemented ? toolkit.authType : "Not built yet"}</small>
                      </div>
                    </div>
                    {toolkit.authType === "none" ? (
                      <span className="ready">Ready</span>
                    ) : active ? (
                      <span className="active">Active</span>
                    ) : (
                      <button
                        className="button"
                        type="button"
                        disabled={!toolkit.implemented || !toolkit.configured}
                        title={toolkit.setupEnv ? `Set ${toolkit.setupEnv}` : undefined}
                        onClick={() => connect(toolkit).catch((reason: Error) => setError(reason.message))}
                      >
                        Connect
                      </button>
                    )}
                    {toolkit.slug === "echo" && mine[0] && (
                      <form className="echo-run" onSubmit={(event) => event.preventDefault()}>
                        <input value={echoMessage} onChange={(event) => setEchoMessage(event.target.value)} />
                        <button
                          className="button"
                          type="button"
                          onClick={() => runEcho(mine[0].id).catch((reason: Error) => setError(reason.message))}
                        >
                          Run
                        </button>
                      </form>
                    )}
                    {toolkit.slug === "echo" && echoResult && <pre className="result">{echoResult}</pre>}
                  </article>
                );
              })}
            </div>
          </section>
        ),
      )}
      {visible.length === 0 && <p className="empty">No apps match that search.</p>}
      {draft && (
        <div className="modal-backdrop">
        <form className="modal" onSubmit={(event) => saveKey(event).catch((reason: Error) => setError(reason.message))}>
          <h2>Connect {draft.name}</h2>
          <label>
            Secret
            <input type="password" value={draft.secret} onChange={(event) => setDraft({ ...draft, secret: event.target.value })} required minLength={8} />
          </label>
          <label className="check">
            <input type="checkbox" checked={draft.shared} onChange={(event) => setDraft({ ...draft, shared: event.target.checked })} />
            Shared with workspace
          </label>
          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={() => setDraft(null)}>Cancel</button>
            <button className="button" type="submit">Save connection</button>
          </div>
        </form>
        </div>
      )}
    </section>
  );
}
