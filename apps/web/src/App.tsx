import { Navigate, Route, Routes } from "react-router-dom";
import { Shell } from "./Shell";
import { AppDetail } from "./pages/AppDetail";
import { Chat } from "./pages/Chat";
import { ConnectAgents } from "./pages/ConnectAgents";
import { ConnectApps } from "./pages/ConnectApps";

export function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Navigate to="/connect/apps" replace />} />
        <Route path="/connect/apps" element={<ConnectApps />} />
        <Route path="/connect/apps/:slug" element={<AppDetail />} />
        <Route path="/connect/agents" element={<ConnectAgents />} />
        <Route path="/chat" element={<Chat />} />
      </Routes>
    </Shell>
  );
}
