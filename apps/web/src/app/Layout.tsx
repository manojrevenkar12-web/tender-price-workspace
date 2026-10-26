import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, NavLink, Outlet, useLocation } from "react-router-dom";

import { useSession } from "../features/auth/useSession";
import type { Role } from "../shared/api/types";
import { session } from "../shared/lib/session";
import styles from "./Layout.module.css";

export function Layout() {
  const s = useSession();
  const qc = useQueryClient();
  const loc = useLocation();
  if (!s) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  const links =
    s.user.kind === "contractor"
      ? [
          { to: "/tenders", label: "Tenders" },
          { to: "/price-check", label: "Price check" },
        ]
      : [{ to: "/bids", label: "Invitations" }];
  return (
    <div className={styles.shell}>
      <aside className={styles.rail}>
        <span className={styles.wordmark}>
          tender price
          <br />
          workspace
        </span>
        <nav className={styles.nav} aria-label="Main">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) => `${styles.link} ${isActive ? styles.active : ""}`}
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className={styles.who}>
          <span className={styles.org}>{s.user.org}</span>
          <span>{s.user.name}</span>
          <button
            type="button"
            className={styles.signout}
            onClick={() => {
              session.clear();
              qc.clear();
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className={styles.main}>
        <div className={styles.inner}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const s = useSession();
  if (!s) return <Navigate to="/login" replace />;
  if (s.user.kind !== role)
    return <Navigate to={s.user.kind === "contractor" ? "/tenders" : "/bids"} replace />;
  return <>{children}</>;
}
