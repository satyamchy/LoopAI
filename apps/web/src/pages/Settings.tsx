import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type SessionUser, type ToolkitCard } from "../api";
import { useBase } from "../paths";

type KeyRow = { id: string; name: string; keyPrefix: string; clientName: string | null; lastSeenAt: string | null };

export function Settings() {
  const base = useBase();
  const [section, setSection] = useState<"general" | "keys">("general");
  const [query, setQuery] = useState("");
  const [user, setUser] = useState<SessionUser | null>(null);
  const [toolkits, setToolkits] = useState<ToolkitCard[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [workspaces, setWorkspaces] = useState<{ workspaceId: string; name: string; role: string }[]>([]);
  const [active, setActive] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<SessionUser>("/v1/auth/me").then(setUser).catch((reason: Error) => setError(reason.message));
    api<{ toolkits: ToolkitCard[] }>("/v1/toolkits").then((body) => setToolkits(body.toolkits)).catch((reason: Error) => setError(reason.message));
    api<{ keys: KeyRow[] }>("/v1/agent-keys").then((body) => setKeys(body.keys)).catch((reason: Error) => setError(reason.message));
    api<{ workspaces: { workspaceId: string; name: string; role: string }[]; active: string }>("/v1/workspaces")
      .then((body) => {
        setWorkspaces(body.workspaces);
        setActive(body.active);
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  const needle = query.trim().toLowerCase();
  const missing = toolkits.filter((toolkit) => toolkit.authType === "oauth2" && toolkit.implemented && !toolkit.configured)
    .filter((toolkit) => !needle || toolkit.displayName.toLowerCase().includes(needle) || (toolkit.setupEnv ?? "").toLowerCase().includes(needle));
  const shownKeys = keys.filter((key) => !needle || key.name.toLowerCase().includes(needle) || key.keyPrefix.toLowerCase().includes(needle));

  return (
    <section className="-mx-6 -my-7 grid min-h-full md:-mx-8 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-b border-stone-200 bg-white px-3 py-4 md:border-b-0 md:border-r">
        <Link className="block px-2 py-2 text-sm text-stone-600 no-underline" to={`${base}/connect/clients`}>← Back</Link>
        <input className="mt-2 w-full rounded-none border-0 bg-transparent px-2 py-2 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search settings" />
        <nav className="mt-3 grid gap-1">
          <button className={section === "general" ? "rounded-md bg-stone-100 px-3 py-2 text-left text-sm font-semibold" : "rounded-md px-3 py-2 text-left text-sm"} type="button" onClick={() => setSection("general")}>General</button>
          <button className={section === "keys" ? "rounded-md bg-stone-100 px-3 py-2 text-left text-sm font-semibold" : "rounded-md px-3 py-2 text-left text-sm"} type="button" onClick={() => setSection("keys")}>Sessions & API key</button>
        </nav>
        {user && (
          <div className="mt-6 flex items-center gap-2 px-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-orange-500 text-sm font-bold text-white">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <strong className="block truncate text-sm">{user.displayName}</strong>
              <small className="block truncate text-stone-500">@{user.username}</small>
            </div>
          </div>
        )}
      </aside>
      <div className="px-6 py-7 md:px-10">
        {error && <p className="mb-4 border border-red-200 bg-red-50 px-3 py-2">{error}</p>}
        {section === "general" ? (
          <div className="mx-auto grid max-w-2xl gap-6">
            <h1 className="text-3xl font-semibold">General</h1>
            <div>
              <h2 className="text-base font-semibold">Workspace</h2>
              <p className="mt-1 text-sm text-stone-500">The name on this login.</p>
              <p className="mt-3">{user?.displayName ?? "…"}</p>
            </div>
            <article className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4">
              <h2 className="text-base font-semibold">Workspaces</h2>
              {workspaces.map((item) => (
                <div key={item.workspaceId} className="flex items-center justify-between gap-3 text-sm">
                  <span>{item.name} · {item.role}</span>
                  {item.workspaceId !== active && (
                    <button className="rounded-md border border-stone-300 px-2 py-1" type="button" onClick={() => api("/v1/workspace/switch", { method: "POST", body: JSON.stringify({ workspaceId: item.workspaceId }) }).then(() => window.location.reload()).catch((reason: Error) => setError(reason.message))}>Switch</button>
                  )}
                </div>
              ))}
              <form className="mt-2 flex gap-2" onSubmit={(event) => { event.preventDefault(); api("/v1/workspace/invites", { method: "POST", body: JSON.stringify({ username: invite }) }).then(() => setInvite("")).catch((reason: Error) => setError(reason.message)); }}>
                <input className="flex-1 rounded-none border border-stone-300 px-2 py-2 text-sm" value={invite} onChange={(event) => setInvite(event.target.value)} placeholder="Invite a username" />
                <button className="rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white" type="submit">Invite</button>
              </form>
            </article>
            <article className="grid gap-2 rounded-lg border border-stone-200 bg-white p-4">
              <h2 className="text-base font-semibold">Needs credentials</h2>
              <p className="text-sm text-stone-500">OAuth apps stay off until both client values are in the API environment. Secrets are not shown here.</p>
              {missing.length === 0 && <p className="text-sm text-stone-500">Every built OAuth app has its client pair set.</p>}
              {missing.map((toolkit) => (
                <p key={toolkit.slug} className="text-sm">
                  <strong>{toolkit.displayName}</strong>
                  <span className="text-stone-500"> — set {toolkit.setupEnv}. Redirect {toolkit.slug === "canva" ? "http://127.0.0.1:8787/v1/oauth/callback" : "http://localhost:8787/v1/oauth/callback"}.</span>
                </p>
              ))}
            </article>
          </div>
        ) : (
          <div className="mx-auto grid max-w-2xl gap-4">
            <h1 className="text-3xl font-semibold">Sessions & API key</h1>
            <p className="text-sm text-stone-500">Prefixes only. The full key is shown once, when you create it.</p>
            {shownKeys.length === 0 && <p className="text-sm text-stone-500">No keys yet.</p>}
            <ul className="grid gap-2">
              {shownKeys.map((key) => (
                <li key={key.id} className="rounded-lg border border-stone-200 bg-white px-4 py-3 text-sm">{key.clientName ?? key.name} · {key.keyPrefix}… · {key.lastSeenAt ? "connected" : "not connected"}</li>
              ))}
            </ul>
            <Link className="w-fit rounded-md bg-orange-500 px-3 py-2 text-sm font-semibold text-white no-underline" to={`${base}/connect/clients`}>Create a key</Link>
          </div>
        )}
      </div>
    </section>
  );
}
