import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api, type Connection, type ToolkitCard } from "../api";
import { AppLogo } from "../AppLogo";
import { useBase } from "../paths";

export function AppDetail() {
  const { slug = "" } = useParams();
  const base = useBase();
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
        <Link to={`${base}/connect/apps`}>← All Apps</Link>
        {error && <p className="mt-3 border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
      </section>
    );
  }

  const blocked = !toolkit.implemented || (toolkit.authType === "oauth2" && !toolkit.configured);

  return (
    <section className="mx-auto grid max-w-5xl gap-4">
      <Link className="text-stone-600 no-underline" to={`${base}/connect/apps`}>← All Apps</Link>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <AppLogo slug={toolkit.slug} name={toolkit.displayName} />
          <div>
            <h1 className="text-3xl font-semibold">{toolkit.displayName}</h1>
            <p className="text-stone-500">{toolkit.description}</p>
          </div>
        </div>
        {toolkit.authType === "oauth2" && (
          <div className="flex gap-2">
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" type="button" disabled={blocked || busy} onClick={() => startOAuth("workspace")}>Connect for my team</button>
            <button className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white disabled:bg-stone-300" type="button" disabled={blocked || busy} onClick={() => startOAuth("user")}>Connect New</button>
          </div>
        )}
      </header>
      {notice && <p className="border border-amber-300 bg-amber-50 px-3 py-2">{notice}</p>}
      {error && <p className="border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
      {blocked && toolkit.setupEnv && <p className="border border-red-200 bg-red-50 px-3 py-2">Set {toolkit.setupEnv} in the API environment, then restart the API. Redirect {toolkit.slug === "canva" ? "http://127.0.0.1:8787/v1/oauth/callback" : "http://localhost:8787/v1/oauth/callback"}.</p>}

      <h2 className="text-base font-semibold">Connected Accounts ({connections.length})</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {connections.map((account) => (
          <article key={account.id} className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-700">● {account.status === "active" ? "Active" : account.status}</span>
              <small className="text-stone-500">{ago(account.createdAt)}</small>
            </div>
            <strong>{account.externalLabel ?? toolkit.displayName}</strong>
            <small className="text-stone-500">{account.scope === "workspace" ? "Shared with workspace" : "Private to you"}</small>
            <div className="flex gap-2">
              {toolkit.authType === "oauth2" && (
                <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" type="button" disabled={busy} onClick={() => startOAuth(account.scope, account.id)}>Reconnect</button>
              )}
              <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" type="button" onClick={() => remove(account.id).catch((reason: Error) => setError(reason.message))}>Delete</button>
            </div>
          </article>
        ))}
        {toolkit.authType === "oauth2" && (
          <button className="rounded-lg border border-stone-200 bg-white p-4 text-stone-600" type="button" disabled={blocked || busy} onClick={() => startOAuth("user")}>
            + Connect another account
          </button>
        )}
        {toolkit.authType === "api_key" && (
          <form className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4" onSubmit={saveKey}>
            <strong>Connect {toolkit.displayName}</strong>
            {toolkit.credentialFields.map((field) => (
              <label key={field.key} className="grid gap-1 text-sm">
                {field.label}
                {field.long ? (
                  <textarea
                    className="min-h-28 rounded-none border border-stone-300 px-2.5 py-2"
                    value={fields[field.key] ?? ""}
                    required={!field.optional}
                    onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })}
                  />
                ) : (
                  <input
                    className="rounded-none border border-stone-300 px-2.5 py-2"
                    type={field.secret === false ? "text" : "password"}
                    value={fields[field.key] ?? ""}
                    minLength={field.secret === false ? undefined : 8}
                    required={!field.optional}
                    autoComplete="off"
                    onChange={(event) => setFields({ ...fields, [field.key]: event.target.value })}
                  />
                )}
              </label>
            ))}
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={scope === "workspace"} onChange={(event) => setScope(event.target.checked ? "workspace" : "user")} />
              Shared with workspace
            </label>
            <button className="w-fit rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white" type="submit" disabled={busy}>Save connection</button>
          </form>
        )}
        {toolkit.authType === "none" && connections.length === 0 && <p className="text-stone-500">Ready. No account is required.</p>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Available actions ({toolkit.actions.length})</h2>
        <input className="rounded-none border border-stone-300 px-2.5 py-2" placeholder="Search actions..." value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="grid gap-3">
        {actions.map((action) => (
          <article key={action.slug} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">{titleCase(action.slug)}</h2>
              <small className="text-stone-500">{action.risk ?? "read"}</small>
            </div>
            <p className="mt-1"><code>{action.slug}</code></p>
            <p className="mt-1 text-stone-600">{action.description}</p>
          </article>
        ))}
        {actions.length === 0 && <p className="text-stone-500">No actions match that search.</p>}
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
