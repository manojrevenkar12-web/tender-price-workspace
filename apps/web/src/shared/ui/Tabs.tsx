import { motion } from "framer-motion";

import { motion as m } from "../theme/tokens";
import styles from "./Tabs.module.css";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export function Tabs<K extends string>({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (k: K) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={styles.tabs}>
      {items.map((t) => (
        <button
          key={t.key}
          role="tab"
          aria-selected={t.key === value}
          className={styles.tab}
          onClick={() => onChange(t.key)}
        >
          {t.label}
          {t.count !== undefined && <span className={styles.count}>{t.count}</span>}
          {t.key === value && (
            <motion.span
              layoutId={`tab-${label}`}
              className={styles.indicator}
              transition={{ duration: m.base, ease: m.ease }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
