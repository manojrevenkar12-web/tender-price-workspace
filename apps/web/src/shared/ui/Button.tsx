import type { ButtonHTMLAttributes, ReactNode } from "react";

import styles from "./Button.module.css";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "normal" | "small";
  busy?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "normal",
  busy = false,
  icon,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={[styles.button, styles[variant], size === "small" ? styles.small : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {busy ? <span className={styles.spinner} aria-hidden /> : icon}
      {children}
    </button>
  );
}
