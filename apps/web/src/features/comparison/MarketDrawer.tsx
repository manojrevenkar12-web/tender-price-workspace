import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

import { formatCents } from "../../shared/lib/format";
import { motion as m } from "../../shared/theme/tokens";
import { Button, ErrorState, SkeletonRows } from "../../shared/ui";
import { useMarket } from "./api";
import styles from "./MarketDrawer.module.css";
import { PriceStrip } from "./PriceStrip";

const REASON: Record<string, string> = {
  no_data: "No comparable work in the price history for this unit and wording.",
  too_few_companies:
    "Fewer than five companies priced comparable work. Their prices are not shown, so that no single company's price can be inferred.",
  dominated:
    "One company supplied most of the comparable prices. The range would reveal its prices, so it is not shown.",
  too_few_points: "Too few comparable prices for a reliable range.",
  lump_sum: "A lump sum covers a scope, not a unit of work, so it has no market price per unit.",
  unknown_unit: "The unit is not one the price history knows.",
};

export function MarketDrawer({
  tenderId,
  oz,
  onClose,
}: {
  tenderId: string;
  oz: string | null;
  onClose: () => void;
}) {
  const q = useMarket(tenderId, oz);
  useEffect(() => {
    if (!oz) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [oz, onClose]);
  return (
    <AnimatePresence>
      {oz && (
        <motion.aside
          className={styles.drawer}
          aria-label={`Market price for ${oz}`}
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: m.base, ease: m.ease }}
        >
          <header className={styles.top}>
            <div>
              <div className={styles.oz}>OZ {oz}</div>
              <div className={styles.title}>{q.data?.position.shortText ?? "Market price"}</div>
            </div>
            <Button variant="ghost" size="small" onClick={onClose}>
              Close
            </Button>
          </header>
          <div className={styles.body}>
            {q.isPending && <SkeletonRows rows={5} label="Loading market price" />}
            {q.isError && <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
            {q.data && q.data.status === "ok" && (
              <>
                <div>
                  <h3 className={styles.h3}>
                    Market range per {q.data.position.unit} in {q.data.region}, {q.data.quarter}
                  </h3>
                  <PriceStrip
                    width={420}
                    height={28}
                    market={{ p10: q.data.p10!, p50: q.data.p50!, p90: q.data.p90! }}
                    dots={[]}
                    label="Market range"
                  />
                  <div className={styles.quantiles}>
                    {(["p10", "p25", "p50", "p75", "p90"] as const).map((k) => (
                      <div key={k} className={styles.q}>
                        <span>{k === "p50" ? "median" : `${k.slice(1)}th pct.`}</span>
                        <strong className={k === "p50" ? styles.median : ""}>{formatCents(q.data[k])}</strong>
                      </div>
                    ))}
                  </div>
                </div>
                <p className={styles.note}>
                  From {q.data.points.toLocaleString("de-DE")} prices by {q.data.companies} companies over the
                  last three years, brought to this region and quarter with the construction price index and
                  regional price levels. Prices are rounded so none can be traced to a bid.
                </p>
              </>
            )}
            {q.data && q.data.status !== "ok" && (
              <p className={styles.note}>
                {REASON[q.data.reason ?? ""] ?? "No market range."}{" "}
                {q.data.companies > 0 && q.data.status === "suppressed"
                  ? `(${q.data.companies} companies)`
                  : ""}
              </p>
            )}
            {q.data && q.data.matches.length > 0 && (
              <div>
                <h3 className={styles.h3}>Matched historical wording</h3>
                <ul className={styles.matches}>
                  {q.data.matches.map((x) => (
                    <li key={x.text} className={styles.match}>
                      <span>{x.text}</span>
                      <span className="num">{Math.round(x.similarity * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
