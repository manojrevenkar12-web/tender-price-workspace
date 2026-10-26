import type { ReactNode } from "react";

import styles from "./Panel.module.css";

export function Panel({
  title,
  actions,
  children,
  flush = false,
  id,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section className={styles.panel} aria-labelledby={id}>
      {(title || actions) && (
        <header className={styles.header}>
          {title && (
            <h2 className={styles.title} id={id}>
              {title}
            </h2>
          )}
          {actions}
        </header>
      )}
      <div className={flush ? styles.flush : styles.body}>{children}</div>
    </section>
  );
}
