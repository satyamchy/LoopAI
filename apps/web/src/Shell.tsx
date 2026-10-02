import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

const links = [
  { to: "/connect/apps", label: "Connect Apps" },
  { to: "/connect/agents", label: "Connect my agent" },
  { to: "/chat", label: "Chat" },
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
          {links.map((link) => (
            <NavLink key={link.to} to={link.to} className={({ isActive }) => (isActive ? "nav active" : "nav")}>
              {link.label}
            </NavLink>
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
