import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const groups = [
  {
    label: "Connect",
    links: [
      { to: "/connect/apps", label: "Apps" },
      { to: "/connect/agents", label: "Agents" },
    ],
  },
  {
    label: "Use",
    links: [{ to: "/chat", label: "Chat" }],
  },
];

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">L</span>
          <strong>LoopAI</strong>
        </div>
        <nav>
          {groups.map((group) => (
            <div key={group.label} className="nav-group">
              <p className="nav-label">{group.label}</p>
              {group.links.map((link) => (
                <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? "nav active" : "nav")}>
                  {link.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="workspace">
          <span className="avatar">S</span>
          <div>
            <strong>My workspace</strong>
            <small>Personal</small>
          </div>
        </div>
      </aside>
      <main className="canvas">{children}</main>
    </div>
  );
}
