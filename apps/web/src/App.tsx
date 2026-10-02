import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api, type SessionUser } from "./api";
import { workspaceHome, workspaceSlug } from "./paths";
import { Shell } from "./Shell";
import { AppDetail } from "./pages/AppDetail";
import { Chat } from "./pages/Chat";
import { ConnectAgents } from "./pages/ConnectAgents";
import { ConnectApps } from "./pages/ConnectApps";
import { Help } from "./pages/Help";
import { Landing } from "./pages/Landing";
import { Settings } from "./pages/Settings";

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Landing />} />
      <Route path="/*" element={<SignedIn />} />
    </Routes>
  );
}

function SignedIn() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);

  useEffect(() => {
    api<SessionUser>("/v1/auth/me").then(setUser).catch(() => setUser(null));
  }, []);

  if (user === undefined) return <main className="grid min-h-screen place-items-center bg-stone-900 text-stone-100"><p>Loading…</p></main>;
  if (!user) return <Landing />;

  const base = workspaceHome(user.username);
  const clients = `${base}/connect/clients/chatgpt`;

  return (
    <Shell user={user}>
      <Routes>
        <Route path="/" element={<Navigate to={clients} replace />} />
        <Route path="/login" element={<Navigate to={clients} replace />} />
        <Route path="/connect/agents" element={<Navigate to={clients} replace />} />
        <Route path="/connect/apps" element={<Forward to={`${base}/connect/apps`} />} />
        <Route path="/connect/apps/:slug" element={<ForwardApps base={base} />} />
        <Route path="/chat" element={<Forward to={`${base}/chat`} />} />
        <Route path="/help" element={<Navigate to={`${base}/help`} replace />} />
        <Route path="/settings" element={<Navigate to={`${base}/settings`} replace />} />
        <Route path="/:workspace/~" element={<InWorkspace user={user}><ConnectAgents /></InWorkspace>} />
        <Route path="/:workspace/~/connect/clients" element={<Navigate to="chatgpt" replace />} />
        <Route path="/:workspace/~/connect/clients/:client" element={<InWorkspace user={user}><ConnectAgents /></InWorkspace>} />
        <Route path="/:workspace/~/connect/apps" element={<InWorkspace user={user}><ConnectApps /></InWorkspace>} />
        <Route path="/:workspace/~/connect/apps/:slug" element={<InWorkspace user={user}><AppDetail /></InWorkspace>} />
        <Route path="/:workspace/~/chat" element={<InWorkspace user={user}><Chat /></InWorkspace>} />
        <Route path="/:workspace/~/help" element={<InWorkspace user={user}><Help /></InWorkspace>} />
        <Route path="/:workspace/~/settings" element={<InWorkspace user={user}><Settings /></InWorkspace>} />
      </Routes>
    </Shell>
  );
}

function Forward({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function ForwardApps({ base }: { base: string }) {
  const { slug } = useParams();
  const location = useLocation();
  return <Navigate to={`${base}/connect/apps/${slug}${location.search}`} replace />;
}

function InWorkspace({ user, children }: { user: SessionUser; children: ReactNode }) {
  const { workspace } = useParams();
  const location = useLocation();
  const expected = workspaceSlug(user.username);
  if (workspace !== expected) {
    return <Navigate to={`${location.pathname.replace(`/${workspace}`, `/${expected}`)}${location.search}`} replace />;
  }
  return children;
}
