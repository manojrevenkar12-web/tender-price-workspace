import type { Flag, Row } from "@tpw/domain";
import { useVirtualizer } from "@tanstack/react-virtual";
import { motion } from "framer-motion";
import { type CSSProperties, useMemo, useRef } from "react";

import type { ComparisonView } from "../../shared/api/types";
import { formatCents, formatCentsRound, formatPercent, formatQuantity } from "../../shared/lib/format";
import { layout, motion as m } from "../../shared/theme/tokens";
import styles from "./ComparisonGrid.module.css";
import { FLAG, worst } from "./flags";
import { PriceStrip } from "./PriceStrip";

type Item = { type: "section"; label: string; key: string } | { type: "row"; row: Row; key: string };

export interface GridProps {
  data: ComparisonView;
  rows: Row[];
  sections: Map<string, string>;
  selectedBid: string | null;
  onSelectBid: (id: string) => void;
  onOpenMarket: (oz: string) => void;
}

const tone = (f: Flag | null) => (f ? `flag-${FLAG[f].tone === "ink" ? "neutral" : FLAG[f].tone}` : "");

export function ComparisonGrid({ data, rows, sections, selectedBid, onSelectBid, onOpenMarket }: GridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const bids = useMemo(() => [...data.bids].sort((a, b) => a.rank - b.rank), [data.bids]);
  const best = bids[0]?.comparableTotal ?? 0;

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    let last = "";
    for (const r of rows) {
      const label = sections.get(r.oz) ?? "";
      if (label && label !== last) {
        out.push({ type: "section", label, key: `s:${r.oz}` });
        last = label;
      }
      out.push({ type: "row", row: r, key: r.oz });
    }
    return out;
  }, [rows, sections]);

  const v = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => layout.gridRowHeight,
    overscan: layout.gridOverscan,
  });
  const style = { "--bids": bids.length } as CSSProperties;

  return (
    <div
      ref={scroller}
      className={styles.scroller}
      style={style}
      role="grid"
      aria-rowcount={items.length + 1}
      aria-colcount={bids.length + 1}
      data-cy="comparison-grid"
    >
      <div className={styles.head} role="row">
        <div className={styles.sticky} role="columnheader">
          <span>OZ</span>
          <span>Position</span>
          <span className={styles.qty}>Quantity</span>
          <span>Bids against the market</span>
        </div>
        {bids.map((b, i) => (
          <motion.button
            key={b.bidId}
            type="button"
            role="columnheader"
            aria-pressed={selectedBid === b.bidId}
            className={`${styles.bidHead} ${selectedBid === b.bidId ? styles.bidHeadActive : ""}`}
            onClick={() => onSelectBid(b.bidId)}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: m.base, delay: Math.min(i, 12) * m.stagger, ease: m.ease }}
            data-cy="bid-column"
          >
            <span className={styles.rank} aria-label={`Rank ${b.rank}`}>
              {b.rank}
            </span>
            <span className={styles.bidder}>{b.bidder}</span>
            <span className={styles.total} title="Comparable total: gaps filled with the other bids' median">
              {formatCentsRound(b.comparableTotal)}
            </span>
            <span className={styles.delta}>
              {b.rank === 1 ? "lowest" : formatPercent((b.comparableTotal - best) / best)}
            </span>
            <span className={styles.counts}>
              {b.flagged ? `${b.flagged} flagged` : "no flags"}
              {b.missing + b.stale ? `, ${b.missing + b.stale} gaps` : ""}
            </span>
          </motion.button>
        ))}
      </div>
      <div style={{ height: v.getTotalSize(), position: "relative" }}>
        {v.getVirtualItems().map((vi) => {
          const it = items[vi.index]!;
          const top = { transform: `translateY(${vi.start}px)` };
          if (it.type === "section")
            return (
              <div key={it.key} className={styles.section} style={top} role="row">
                <span className={styles.sectionLabel}>{it.label}</span>
              </div>
            );
          const r = it.row;
          const prices = bids.map((b) => r.cells[b.bidId]);
          const min = r.min;
          return (
            <div key={it.key} className={styles.row} style={top} role="row" data-oz={r.oz}>
              <div className={styles.sticky} role="rowheader">
                <button
                  type="button"
                  className={styles.oz}
                  onClick={() => onOpenMarket(r.oz)}
                  title="Market price for this position"
                >
                  {r.oz}
                </button>
                <span className={styles.text} title={r.shortText}>
                  {r.shortText}
                </span>
                <span className={styles.qty}>
                  {formatQuantity(r.quantity)} {r.unit}
                </span>
                <PriceStrip
                  market={r.market}
                  label={
                    r.market
                      ? `Market ${formatCents(r.market.p10)} to ${formatCents(r.market.p90)}`
                      : "No market range"
                  }
                  dots={prices.flatMap((c, i) =>
                    c && c.unitPrice !== null
                      ? [
                          {
                            value: c.unitPrice,
                            kind:
                              c.standing === "stale"
                                ? ("stale" as const)
                                : c.flags.length
                                  ? ("flag" as const)
                                  : ("plain" as const),
                            active: bids[i]!.bidId === selectedBid,
                          },
                        ]
                      : [],
                  )}
                />
              </div>
              {bids.map((b) => {
                const c = r.cells[b.bidId];
                const f = c ? worst(c.flags) : "missing";
                return (
                  <div
                    key={b.bidId}
                    role="gridcell"
                    className={`${styles.cell} ${styles[tone(f)] ?? ""} ${c?.unitPrice !== null && c?.unitPrice === min && !c?.flags.length ? styles.best : ""}`}
                    title={
                      c?.flags.map((x) => `${FLAG[x].label}: ${FLAG[x].explain}`).join("\n") || undefined
                    }
                    data-flag={f ?? undefined}
                  >
                    {c?.unitPrice !== null && c?.unitPrice !== undefined
                      ? formatCents(c.unitPrice)
                      : FLAG.missing.label}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
