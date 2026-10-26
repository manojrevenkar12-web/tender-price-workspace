import type { ReactNode } from "react";

import styles from "./Badge.module.css";

export type Tone = "neutral" | "market" | "stale" | "alert" | "caution" | "ink";

export function Badge({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`${styles.badge} ${styles[tone]}`} title={title}>
      {children}
    </span>
  );
}
