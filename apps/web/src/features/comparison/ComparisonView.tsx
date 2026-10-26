import type { Flag } from "@tpw/domain";
import { useMemo, useState } from "react";

import type { TenderDetail } from "../../shared/api/types";
import { formatCents, formatCentsRound } from "../../shared/lib/format";
import { Badge, Button, Dialog, EmptyState, QueryState, SkeletonRows, useToast } from "../../shared/ui";
import { useAward } from "../tenders/api";
import { useComparison } from "./api";
import { ComparisonGrid } from "./ComparisonGrid";
import styles from "./ComparisonView.module.css";
import { FLAG } from "./flags";
import { MarketDrawer } from "./MarketDrawer";

type Filter = "all" | "flagged" | "gaps";

export function ComparisonView({ tender }: { tender: TenderDetail }) {
  const q = useComparison(tender.id);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [marketOz, setMarketOz] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const award = useAward(tender.id);
  const toast = useToast();
  const sections = useMemo(
    () => new Map(tender.positions.map((p) => [p.oz, p.section.join(" / ")])),
    [tender.positions],
  );

  return (
    <QueryState
      query={q}
      skeleton={<SkeletonRows rows={10} label="Loading the price comparison" />}
      isEmpty={(d) => d.bids.length === 0}
      empty={
        <EmptyState title="No bids submitted yet">
          The comparison fills in as invited companies submit. Market ranges for the positions are ready for
          when they do; open a position number on the bill of quantities to see one.
        </EmptyState>
      }
    >
      {(data) => {
        const term = search.trim().toLowerCase();
        const rows = data.rows.filter((r) => {
          const cells = Object.values(r.cells);
          if (
            filter === "flagged" &&
            !cells.some((c) => c.flags.some((f) => f !== "missing" && f !== "stale"))
          )
            return false;
          if (filter === "gaps" && !cells.some((c) => c.standing === "missing" || c.standing === "stale"))
            return false;
          return !term || r.oz.includes(term) || r.shortText.toLowerCase().includes(term);
        });
        const counts = new Map<Flag, number>();
        for (const r of data.rows)
          for (const c of Object.values(r.cells))
            for (const f of c.flags) counts.set(f, (counts.get(f) ?? 0) + 1);
        const best = [...data.bids].sort((a, b) => a.rank - b.rank)[0]!;
        const chosen = data.bids.find((b) => b.bidId === selected) ?? null;
        const inMarket = data.rows.filter((r) => r.market).length;
        const awardable = tender.status === "open" || tender.status === "closed";
        return (
          <>
            <div className={styles.summary}>
              <div className={styles.figure}>
                <strong>{formatCentsRound(best.comparableTotal)}</strong>
                <span>lowest comparable total, {best.bidder}</span>
              </div>
              <div className={`${styles.figure} ${styles.figureMarket}`}>
                <strong className="num">
                  {inMarket} of {data.rows.length}
                </strong>
                <span>
                  positions with a market range{" "}
                  {data.benchmarks.ready < data.benchmarks.total ? "(still computing)" : ""}
                </span>
              </div>
              <div className={`${styles.figure} ${styles.figureAlert}`}>
                <strong className="num">
                  {(counts.get("decimal_slip") ?? 0) + (counts.get("zero_price") ?? 0)}
                </strong>
                <span>prices that look like typing errors</span>
              </div>
              <div className={`${styles.figure} ${styles.figureStale}`}>
                <strong className="num">{(counts.get("stale") ?? 0) + (counts.get("missing") ?? 0)}</strong>
                <span>prices missing or on an old version</span>
              </div>
            </div>
            <div className={styles.toolbar}>
              <div className={styles.filters} role="group" aria-label="Show">
                {(
                  [
                    ["all", `All ${data.rows.length}`],
                    ["flagged", "Flagged prices"],
                    ["gaps", "Gaps and old prices"],
                  ] as const
                ).map(([k, label]) => (
                  <button
                    key={k}
                    type="button"
                    className={styles.filter}
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                className={styles.search}
                type="search"
                placeholder="Find OZ or text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Find position"
              />
              {chosen && awardable && (
                <Button variant="primary" onClick={() => setConfirm(true)} data-cy="award">
                  Award to {chosen.bidder}
                </Button>
              )}
            </div>
            {rows.length === 0 ? (
              <EmptyState title="Nothing matches">
                No position matches this filter. Show all positions to see the full comparison.
              </EmptyState>
            ) : (
              <ComparisonGrid
                data={data}
                rows={rows}
                sections={sections}
                selectedBid={selected}
                onSelectBid={setSelected}
                onOpenMarket={setMarketOz}
              />
            )}
            <div className={styles.legend} aria-label="Legend">
              {(Object.keys(FLAG) as Flag[]).map((f) => (
                <Badge key={f} tone={FLAG[f].tone} title={FLAG[f].explain}>
                  {FLAG[f].label} {counts.get(f) ?? 0}
                </Badge>
              ))}
            </div>
            <MarketDrawer tenderId={tender.id} oz={marketOz} onClose={() => setMarketOz(null)} />
            <Dialog
              open={confirm && chosen !== null}
              onClose={() => setConfirm(false)}
              title={`Award to ${chosen?.bidder ?? ""}?`}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    busy={award.isPending}
                    onClick={() =>
                      award.mutate(chosen!.bidId, {
                        onSuccess: () => {
                          setConfirm(false);
                          toast(`Awarded to ${chosen!.bidder}. Its prices join the price history.`);
                        },
                        onError: (e) => toast(e.message, "error"),
                      })
                    }
                  >
                    Award
                  </Button>
                </>
              }
            >
              {chosen && (
                <div className={styles.awardFacts}>
                  <p>
                    Total {formatCents(chosen.total)}, comparable total {formatCents(chosen.comparableTotal)}{" "}
                    (rank {chosen.rank} of {data.bids.length}).
                  </p>
                  {chosen.flagged > 0 && (
                    <p>
                      {chosen.flagged} of its prices are flagged. Clarify them with the bidder before the
                      contract if they matter.
                    </p>
                  )}
                  <p>Awarding closes the tender for every bidder. It cannot be undone here.</p>
                </div>
              )}
            </Dialog>
          </>
        );
      }}
    </QueryState>
  );
}
