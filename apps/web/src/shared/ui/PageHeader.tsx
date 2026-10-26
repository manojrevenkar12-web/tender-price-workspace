import type { ReactNode } from "react";

import styles from "./PageHeader.module.css";

export function PageHeader({
  title,
  sub,
  actions,
  badge,
}: {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <div>
        <h1 className={styles.title}>
          {title} {badge}
        </h1>
        {sub && <p className={styles.sub}>{sub}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
