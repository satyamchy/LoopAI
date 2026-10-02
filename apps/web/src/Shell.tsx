import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api, type SessionUser } from "./api";
import { workspaceHome } from "./paths";

const icons = {
  home: "M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z",
  apps: "M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z",
  agent: "M12 3v12m0 0 4-4m-4 4-4-4M5 21h14",
  chat: "M5 6h14v9H8l-3 3V6z",
  help: "M12 18h.01M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4",
  settings: "M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10-1.4 1.4",
};

type ChatItem = { id: string; title: string };

export function Shell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const base = workspaceHome(user.username);
  const chat = location.pathname.endsWith("/~/chat");
  const onClients = location.pathname.includes("/connect/clients");
  const [accountOpen, setAccountOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [chats, setChats] = useState<ChatItem[]>([]);
  const activeChat = params.get("c");

  useEffect(() => {
    if (!chat) return;
    api<{ conversations: ChatItem[] }>("/v1/conversations")
      .then((body) => setChats(body.conversations))
      .catch(() => setChats([]));
  }, [chat, location.key]);

  function search(event: FormEvent) {
    event.preventDefault();
    navigate(`${base}/connect/apps?q=${encodeURIComponent(query.trim())}`);
  }

  async function logout() {
    await api("/v1/auth/logout", { method: "POST" });
    window.location.href = "/";
  }

  async function removeChat(item: ChatItem) {
    if (!window.confirm(`Delete “${item.title}”?`)) return;
    await api(`/v1/conversations/${item.id}`, { method: "DELETE" });
    setChats((rows) => rows.filter((row) => row.id !== item.id));
    if (activeChat === item.id) navigate(`${base}/chat`);
  }

  const links = [
    { to: `${base}/connect/clients/chatgpt`, label: "Home", active: location.pathname.endsWith("/connect/clients/chatgpt"), icon: icons.home },
    { to: `${base}/connect/apps`, label: "Connect Apps", active: location.pathname.includes("/connect/apps"), icon: icons.apps },
    { to: `${base}/connect/clients/chatgpt`, label: "Connect my agent", active: onClients, icon: icons.agent },
    { to: `${base}/chat`, label: "Chat", active: chat && !activeChat, icon: icons.chat },
    { to: `${base}/help`, label: "Help", active: location.pathname.endsWith("/~/help"), icon: icons.help },
  ];

  return (
    <div className="grid h-dvh grid-cols-[240px_minmax(0,1fr)] overflow-hidden bg-stone-900 text-stone-100">
      <aside className="desk flex h-dvh w-full flex-col border-r border-stone-800 bg-stone-900">
        <form className="shrink-0 px-3 pt-4" onSubmit={search}>
          <input className="w-full rounded-none border-0 bg-transparent px-2 py-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" aria-label="Search apps" />
        </form>
        <nav className="grid shrink-0 gap-1 px-2">
          {links.map((link) => (
            <Link key={link.label} to={link.to} className={navClass(link.active)} aria-current={link.active ? "page" : undefined}>
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d={link.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {link.label}
            </Link>
          ))}
        </nav>
        {chat ? (
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            <p className="px-3 text-[11px] font-bold tracking-wide text-stone-400">TODAY</p>
            {chats.map((item) => (
              <div key={item.id} className="flex items-center gap-1">
                <Link to={`${base}/chat?c=${item.id}`} className={`${navClass(activeChat === item.id)} min-w-0 flex-1`} aria-current={activeChat === item.id ? "page" : undefined}>
                  <span className="truncate">{item.title}</span>
                </Link>
                <button className="shrink-0 px-1 text-xs text-stone-400" type="button" aria-label={`Delete ${item.title}`} onClick={() => removeChat(item).catch(() => undefined)}>Delete</button>
              </div>
            ))}
            {chats.length === 0 && <p className="px-3 py-2 text-sm text-stone-500">No chats yet.</p>}
          </div>
        ) : <div className="flex-1" />}
        <div className="shrink-0 border-t border-stone-800 px-2 py-3">
          <NavLink to={`${base}/settings`} className={() => navClass(location.pathname.endsWith("/~/settings"))}>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3" />
              <path d={icons.settings} strokeLinecap="round" />
            </svg>
            Settings
          </NavLink>
          <div className="mt-2 flex items-center gap-2 px-2">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-orange-500 text-sm font-bold text-white">{user.displayName.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0">
              <strong className="block truncate text-sm">{user.displayName}</strong>
              <small className="block truncate text-stone-400">@{user.username}</small>
            </div>
            <button className="ml-auto text-stone-400" type="button" aria-label="Account menu" onClick={() => setAccountOpen((value) => !value)}>⌄</button>
          </div>
          {accountOpen && (
            <button className="mt-2 px-2 text-left text-sm text-stone-400" type="button" onClick={() => logout().catch(() => { window.location.href = "/"; })}>Log out</button>
          )}
        </div>
      </aside>
      <main className="h-dvh min-h-0 overflow-hidden bg-stone-900">
        {chat ? children : <div className="desk h-full overflow-y-auto bg-stone-900 px-6 py-7 text-stone-100 md:px-8">{children}</div>}
      </main>
    </div>
  );
}

function navClass(active: boolean): string {
  const base = "flex items-center gap-2 rounded-md px-3 py-2 text-sm no-underline";
  return active ? `${base} bg-orange-500/15 font-semibold text-orange-300` : `${base} text-stone-300`;
}
