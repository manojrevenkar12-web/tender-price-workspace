import { cents, lineTotal } from "@tpw/domain";
import { useVirtualizer } from "@tanstack/react-virtual";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ApiError, authedUrl } from "../../shared/api/client";
import type { Position } from "../../shared/api/types";
import { formatCents, formatDate, formatQuantity, relativeDeadline } from "../../shared/lib/format";
import { layout, motion as m } from "../../shared/theme/tokens";
import { Badge, Button, Dialog, ErrorState, PageHeader, SkeletonRows, useToast } from "../../shared/ui";
import { useDiff, useTender } from "../tenders/api";
import { useBid, useDecline, useImportX84, useSubmitBid } from "./api";
import styles from "./BidPage.module.css";
import { type SaveState, useBidEditor } from "./useBidEditor";

const SAVE_LABEL: Record<SaveState, string> = {
  idle: "All prices saved",
  pending: "Unsaved changes",
  saving: "Saving",
  saved: "All prices saved",
  conflict: "Changed elsewhere",
  error: "Not saved",
};

const carriesTotal = (p: Position) => p.kind === "normal" || p.kind === "lump";
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function BidPage() {
  const { id = "" } = useParams();
  const tender = useTender(id);
  const bid = useBid(id);
  const open =
    tender.data?.status === "open" &&
    (!tender.data.deadline || new Date(tender.data.deadline).getTime() > Date.now());
  const editor = useBidEditor(id, bid.data, Boolean(open));
  const submit = useSubmitBid(id);
  const importX84 = useImportX84(id);
  const decline = useDecline(id);
  const toast = useToast();
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const priced = bid.data?.version ?? tender.data?.version ?? 1;
  const diff = useDiff(
    id,
    priced,
    tender.data?.version ?? 1,
    Boolean(bid.data && tender.data && bid.data.version < tender.data.version),
  );

  const positions = useMemo(() => tender.data?.positions ?? [], [tender.data]);
  const changes = useMemo(() => new Map((diff.data ?? []).map((c) => [c.oz, c.type])), [diff.data]);
  // Prices for work that changed in an addendum no longer stand: shown empty until re-priced
  // (the server drops them on the next save).
  const staleOz = useMemo(
    () => new Set([...changes].filter(([, t]) => t === "work").map(([oz]) => oz)),
    [changes],
  );
  const priceOf = (oz: string) => (staleOz.has(oz) && !editor.dirty.has(oz) ? undefined : editor.prices[oz]);
  const total = useMemo(
    () =>
      positions.filter(carriesTotal).reduce((s, p) => {
        const c = staleOz.has(p.oz) && !editor.dirty.has(p.oz) ? undefined : editor.prices[p.oz];
        return s + (c !== undefined ? lineTotal(cents(c), p.quantity) : 0);
      }, 0),
    [positions, editor.prices, editor.dirty, staleOz],
  );
  const required = positions.filter(carriesTotal);
  const done = required.filter((p) => priceOf(p.oz) !== undefined).length;
  const v = useVirtualizer({
    count: positions.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => layout.gridRowHeight + 8,
    overscan: layout.gridOverscan,
  });

  if (tender.isPending || bid.isPending) return <SkeletonRows rows={10} label="Loading the tender" />;
  if (tender.isError)
    return (
      <ErrorState
        error={tender.error}
        onRetry={() => void tender.refetch()}
        title="This tender could not be loaded"
      />
    );
  if (bid.isError)
    return (
      <ErrorState error={bid.error} onRetry={() => void bid.refetch()} title="Your bid could not be loaded" />
    );
  const t = tender.data;
  const b = bid.data;

  const doSubmit = async () => {
    try {
      await submit.mutateAsync(await editor.flush());
      setMissing(new Set());
      toast("Bid submitted. You can still change it until the deadline.");
    } catch (e) {
      if (e instanceof ApiError && e.code === "incomplete_bid") {
        const list = (e.details as { oz: string }[]).map((d) => d.oz);
        setMissing(new Set(list));
        const first = positions.findIndex((p) => p.oz === list[0]);
        if (first >= 0) v.scrollToIndex(first, { align: "center" });
      }
      toast(e instanceof Error ? e.message : "Submitting failed", "error");
    }
  };

  const upload = async (file: File) => {
    const r = await importX84.mutateAsync({ xml: await file.text(), revision: await editor.flush() });
    toast(
      `Imported ${Object.keys(r.bid.prices).length} prices${r.ignored.length ? `; ${r.ignored.length} positions in the file are not in this BoQ` : ""}.`,
    );
  };

  return (
    <>
      <PageHeader
        title={t.title}
        badge={
          b?.status === "submitted" ? (
            <Badge tone="market">Submitted</Badge>
          ) : (
            <Badge tone="caution">Draft</Badge>
          )
        }
        sub={
          <>
            {t.project.name}, {t.project.city}. Deadline{" "}
            {t.deadline ? `${formatDate(t.deadline)} (${relativeDeadline(t.deadline)})` : "not set"}.
          </>
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => window.open(authedUrl(`/api/tenders/${id}/bid/gaeb`), "_blank")}
            >
              Download X84
            </Button>
            {open && (
              <label className={styles.upload}>
                Upload X84
                <input
                  type="file"
                  accept=".x84,.xml"
                  onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
                />
              </label>
            )}
            {open && b?.status !== "submitted" && (
              <Button variant="ghost" onClick={() => setDeclining(true)}>
                Decline
              </Button>
            )}
          </>
        }
      />

      <AnimatePresence>
        {diff.data && diff.data.length > 0 && (
          <motion.section
            className={styles.addendum}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: m.base, ease: m.ease }}
            role="status"
            data-cy="addendum-banner"
          >
            <strong>
              The bill of quantities changed (version {priced} to {t.version}).
            </strong>{" "}
            {plural(
              diff.data.filter((c) => c.type === "work").length,
              "position describes",
              "positions describe",
            )}{" "}
            different work and needs a new price,{" "}
            {plural(diff.data.filter((c) => c.type === "added").length, "position was", "positions were")}{" "}
            added and {plural(diff.data.filter((c) => c.type === "quantity").length, "has a", "have")} new
            quantity (your price stands). They are marked below. Saving moves your bid to version {t.version}.
          </motion.section>
        )}
        {editor.state === "conflict" && (
          <motion.section
            className={styles.conflict}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="alert"
          >
            Someone else in your company saved prices for this bid. Your last changes were not saved.{" "}
            <Button size="small" onClick={() => void bid.refetch()}>
              Load their version
            </Button>
          </motion.section>
        )}
      </AnimatePresence>

      <div className={styles.bar}>
        <span className={styles.progress}>
          <strong className="num">
            {done} of {required.length}
          </strong>{" "}
          positions priced
        </span>
        <span className={styles.total}>
          Total <strong className="num">{formatCents(total)}</strong>
        </span>
        <span className={`${styles.save} ${styles[editor.state]}`} aria-live="polite">
          {SAVE_LABEL[editor.state]}
          {editor.error ? `: ${editor.error}` : ""}
        </span>
        {open ? (
          <Button
            variant="primary"
            busy={submit.isPending}
            onClick={() => void doSubmit()}
            data-cy="submit-bid"
          >
            {b?.status === "submitted" ? "Submit again" : "Submit bid"}
          </Button>
        ) : (
          <Badge tone="stale">Bidding is closed</Badge>
        )}
      </div>

      <div ref={scroller} className={styles.scroller} role="table" aria-label="Positions to price">
        <div className={styles.headRow} role="row">
          <span role="columnheader">OZ</span>
          <span role="columnheader">Position</span>
          <span role="columnheader" className={styles.right}>
            Quantity
          </span>
          <span role="columnheader" className={styles.right}>
            Unit price (€)
          </span>
          <span role="columnheader" className={styles.right}>
            Total
          </span>
        </div>
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((vi) => {
            const p = positions[vi.index]!;
            const change = changes.get(p.oz);
            const value = staleOz.has(p.oz) && !editor.dirty.has(p.oz) ? "" : (editor.inputs[p.oz] ?? "");
            const bad = editor.invalid.has(p.oz);
            const price = priceOf(p.oz);
            const needed = missing.has(p.oz) && price === undefined;
            return (
              <div
                key={p.oz}
                className={`${styles.row} ${needed ? styles.needed : ""} ${change === "work" ? styles.changedWork : change === "added" ? styles.added : ""}`}
                style={{ transform: `translateY(${vi.start}px)` }}
                role="row"
                data-oz={p.oz}
                data-change={change}
              >
                <span className={styles.oz}>{p.oz}</span>
                <span className={styles.text} title={p.longText || p.shortText}>
                  {change === "work" && <Badge tone="stale">Changed: price again</Badge>}
                  {change === "added" && <Badge tone="market">New</Badge>}
                  {change === "quantity" && <Badge>New quantity</Badge>}
                  {p.shortText}
                  {p.kind !== "normal" && (
                    <Badge>
                      {p.kind === "lump" ? "Lump sum" : p.kind === "optional" ? "Optional" : "Alternative"}
                    </Badge>
                  )}
                </span>
                <span className={`${styles.right} num`}>
                  {formatQuantity(p.quantity)} {p.unit}
                </span>
                <span className={styles.right}>
                  <input
                    className={`${styles.price} ${bad ? styles.priceBad : ""}`}
                    aria-label={`Unit price for ${p.oz}`}
                    aria-invalid={bad || undefined}
                    inputMode="decimal"
                    disabled={!open}
                    value={value}
                    placeholder="0,00"
                    onChange={(e) => editor.change(p.oz, e.target.value)}
                    onBlur={() => void editor.flush()}
                  />
                </span>
                <span className={`${styles.right} num ${styles.lineTotal}`}>
                  {price !== undefined && carriesTotal(p)
                    ? formatCents(lineTotal(cents(price), p.quantity))
                    : ""}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <Dialog
        open={declining}
        onClose={() => setDeclining(false)}
        title="Decline this tender?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              busy={decline.isPending}
              onClick={() =>
                decline.mutate(reason, {
                  onSuccess: () => {
                    setDeclining(false);
                    toast("Declined. The buyer has been told.");
                  },
                })
              }
            >
              Decline
            </Button>
          </>
        }
      >
        <p>The buyer sees that you declined and your reason.</p>
        <textarea
          className={styles.reason}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
        />
      </Dialog>
    </>
  );
}
