import { AnimatePresence, motion } from "framer-motion";
import { createContext, type ReactNode, useCallback, useContext, useState } from "react";

import { motion as m } from "../theme/tokens";
import styles from "./Toast.module.css";

interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

const Ctx = createContext<(text: string, tone?: Toast["tone"]) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4_000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className={styles.stack} aria-live="polite">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              className={`${styles.toast} ${t.tone === "error" ? styles.error : ""}`}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 24 }}
              transition={{ duration: m.base, ease: m.ease }}
            >
              {t.text}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
