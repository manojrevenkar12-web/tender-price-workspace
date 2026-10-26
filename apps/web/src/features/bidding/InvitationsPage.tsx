import { motion } from "framer-motion";
import { Link } from "react-router-dom";

import type { TenderSummary } from "../../shared/api/types";
import { relativeDeadline } from "../../shared/lib/format";
import { motion as m } from "../../shared/theme/tokens";
import { Badge, EmptyState, PageHeader, QueryState, SkeletonRows, type Tone } from "../../shared/ui";
import { useTenders } from "../tenders/api";
import { TRADE_LABEL } from "../tenders/status";
import styles from "./InvitationsPage.module.css";

function state(t: TenderSummary): { label: string; tone: Tone } {
  if (t.status === "awarded") return { label: "Awarded", tone: "ink" };
  if (t.status === "closed") return { label: "Closed", tone: "stale" };
  if (t.myBid === "submitted") return { label: "Bid submitted", tone: "market" };
  if (t.myBid === "draft") return { label: "Draft bid", tone: "caution" };
  return { label: "Not started", tone: "neutral" };
}

export function InvitationsPage() {
  const q = useTenders();
  return (
    <>
      <PageHeader title="Invitations" sub="Tenders you have been invited to price." />
      <QueryState
        query={q}
        skeleton={<SkeletonRows rows={3} height="8rem" label="Loading invitations" />}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState title="No invitations">
            When a general contractor invites your company to a tender, it appears here.
          </EmptyState>
        }
      >
        {(data) => (
          <div className={styles.grid}>
            {data.map((t, i) => {
              const s = state(t);
              return (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: m.base, delay: i * m.stagger, ease: m.ease }}
                >
                  <Link to={`/bids/${t.id}`} className={styles.card} data-cy="invitation">
                    <span className={styles.title}>{t.title}</span>
                    <span className={styles.project}>
                      {t.project}, {t.city}
                    </span>
                    <span className={styles.foot}>
                      <Badge tone={s.tone}>{s.label}</Badge>
                      <span>
                        {TRADE_LABEL[t.trade] ?? t.trade}, {t.positions.toLocaleString("de-DE")} positions,{" "}
                        {relativeDeadline(t.deadline)}
                      </span>
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </QueryState>
    </>
  );
}
