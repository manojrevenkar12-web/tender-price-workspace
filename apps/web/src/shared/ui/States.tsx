import type { ReactNode } from "react";

import { ApiError } from "../api/client";
import { Button } from "./Button";
import styles from "./States.module.css";

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={styles.state} aria-label={title}>
      <h2 className={styles.title}>{title}</h2>
      {children && <p className={styles.body}>{children}</p>}
      {action}
    </section>
  );
}

export function ErrorState({
  error,
  onRetry,
  title = "This could not be loaded",
}: {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}) {
  const message = error instanceof Error ? error.message : "Unexpected error.";
  const code = error instanceof ApiError ? error.code : null;
  return (
    <section className={`${styles.state} ${styles.error}`} role="alert">
      <h2 className={styles.title}>{title}</h2>
      <p className={styles.body}>{message}</p>
      {code && <span className={styles.code}>Error code: {code}</span>}
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </section>
  );
}
