import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Connection, type ToolkitCard } from "../api";

export function AppDetail() {
  const { slug = "" } = useParams();
  const [params] = useSearchParams();
  const [toolkit, setToolkit] = useState<ToolkitCard | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(params.get("error") ? "The app did not connect. Check the client id and secret, then try again." : null);
  const [notice, setNotice] = useState<string | null>(params.get("connected") ? "Account connected." : null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [scope, setScope] = useState<"user" | "workspace">("user");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const catalog = await api<{ toolkits: ToolkitCard[] }>("/v1/toolkits");
    const found = catalog.toolkits.find((item) => item.slug === slug) ?? null;
    setToolkit(found);
    if (!found) setError("This app is not in the catalog.");
    try {
      const linked = await api<{ connections: Connection[] }>("/v1/connections");
      setConnections(linked.connections.filter((item) => item.toolkitSlug === slug));
    } catch (reason) {
      setConnections([]);
      setError(reason instanceof Error ? reason.message : "Connections could not be loaded.");
    }
  }

  useEffect(() => {
    reload().catch((reason: Error) => setError(reason.message));
  }, [slug]);

  const actions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (toolkit?.actions ?? []).filter((action) => `${action.slug} ${action.description}`.toLowerCase().includes(needle));
  }, [toolkit, query]);

  async function startOAuth(nextScope: "user" | "workspace", accountId?: string) {
    setError(null);
    setBusy(true);
    try {
      const started = await api<{ url: string }>("/v1/connections/start", {
        method: "POST",
        body: JSON.stringify({ toolkit: slug, scope: nextScope, accountId }),
      });
      window.location.href = started.url;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start the connection.");
      setBusy(false);
    }
  }

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api("/v1/connections", {
        method: "POST",
        body: JSON.stringify({ toolkit: slug, scope, credentials: fields }),
      });
      setFields({});
      setNotice("Account connected.");
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setError(null);
    await api(`/v1/connections/${id}`, { method: "DELETE" });
    await reload();
  }

  if (!toolkit) {
    return (
      <section>
        <Link to="/connect/apps">← All Apps</Link>
        {error && <p className="banner error">{error}</p>}
      </section>
    );
  }

  const blocked = !toolkit.implemented || (toolkit.authType === "oauth2" && !toolkit.configured);

  return (
    <section className="detail page">
      <Link className="back" to="/connect/apps">← All Apps</Link>
      <header className="page-head">
        <div className="card-main">
          <span className="app-mark">{toolkit.displayName.slice(0, 1)}</span>
          <div>
            <h1>{toolkit.displayName}</h1>
            <p>{toolkit.description}</p>
          </div>
        </div>
        {toolkit.authType === "oauth2" && (
          <div className="modal-actions">
            <button className="button ghost" type="button" disabled={blocked || busy} onClick={() => startOAuth("workspace")}>Connect for my team</button>
            <button className="button" type="button" disabled={blocked || busy} onClick={() => startOAuth("user")}>Connect New</button>
          </div>
        )}
      </header>
      {notice && <p className="banner">{notice}</p>}
      {error && <p className="banner error">{error}</p>}
      {blocked && toolkit.setupEnv && <p className="banner error">Set {toolkit.setupEnv} in the API environment, then restart the API.</p>}

      <h2 className="section-title">Connected Accounts ({connections.length})</h2>
      <div className="account-grid">
        {connections.map((account) => (
          <article key={account.id} className="panel account">
            <div className="account-meta">
              <span className="active">● {account.status === "active" ? "Active" : account.status}</span>
              <small>{ago(account.createdAt)}</small>
            </div>
            <strong>{account.externalLabel ?? toolkit.displayName}</strong>
            <small>{account.scope === "workspace" ? "Shared with workspace" : "Private to you"}</small>
            <div className="modal-actions">
              {toolkit.authType === "oauth2" && (
                <button className="button ghost" type="button" disabled={busy} onClick={() => startOAuth(account.scope, account.id)}>Reconnect</button>
              )}
              <button className="button ghost" type="button" onClick={() => remove(account.id).catch((reason: Error) => setError(reason.message))}>Delete</button>
            </div>
          </article>
        ))}
        {toolkit.authType === "oauth2" && (
          <button className="panel account add" type="button" disabled={blocked || busy} onClick={() => startOAuth("user")}>
            + Connect another account
          </button>
        )}
        {toolkit.authType === "api_key" && (
          <form className="panel account" onSubmit={saveKey}>
            <strong>Connect {toolkit.displayName}</strong>
            {toolkit.credentialFields.map((field) => (
              <label key={field.key}>
                {field.label}
                <input
                  type="password"
                  value={fields[field.key] ?? ""}
                  minLength={8}
                  required
                  autoComplete="off"
                  onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })}
                />
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={scope === "workspace"} onChange={(event) => setScope(event.target.checked ? "workspace" : "user")} />
              Shared with workspace
            </label>
            <button className="button" type="submit" disabled={busy}>Save connection</button>
          </form>
        )}
        {toolkit.authType === "none" && connections.length === 0 && <p className="empty">Ready. No account is required.</p>}
      </div>

      <div className="toolbar">
        <h2>Available actions ({toolkit.actions.length})</h2>
        <input className="search" placeholder="Search actions..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="action-list">
        {actions.map((action) => (
          <article key={action.slug} className="panel">
            <div className="account-meta">
              <h2>{titleCase(action.slug)}</h2>
              <small>{action.risk ?? "read"}</small>
            </div>
            <p><code>{action.slug}</code></p>
            <p>{action.description}</p>
          </article>
        ))}
        {actions.length === 0 && <p className="empty">No actions match that search.</p>}
      </div>
    </section>
  );
}

function ago(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 60) return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hours ago`;
  return `${Math.round(hours / 24)} days ago`;
}

function titleCase(slug: string): string {
  return slug.split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
