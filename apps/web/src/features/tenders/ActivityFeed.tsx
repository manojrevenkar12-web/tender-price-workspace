import { AnimatePresence, motion } from "framer-motion";

import type { Activity } from "../../shared/api/types";
import { formatTime } from "../../shared/lib/format";
import { motion as m } from "../../shared/theme/tokens";
import { EmptyState, QueryState, SkeletonRows } from "../../shared/ui";
import styles from "./ActivityFeed.module.css";
import { useActivity } from "./api";

export function describe(e: Activity): string {
  const p = e.payload;
  switch (e.kind) {
    case "tender_created":
      return `created the tender with ${p["positions"]} positions`;
    case "tender_published":
      return "published the tender";
    case "invited":
      return `invited ${p["count"]} companies`;
    case "viewed":
      return "opened the tender";
    case "declined":
      return `declined${p["reason"] ? `: “${String(p["reason"])}”` : ""}`;
    case "bid_submitted":
      return `submitted a bid on version ${p["version"]}`;
    case "bid_reopened":
      return "reopened its bid to change prices";
    case "bid_rebased":
      return `moved its bid to version ${p["to"]}; ${(p["dropped"] as string[]).length} prices for changed work were dropped`;
    case "addendum_published":
      return `published addendum version ${p["version"]} with ${p["changes"]} changes`;
    case "benchmarks_ready":
      return `market ranges ready for ${p["ok"]} of ${p["total"]} positions (version ${p["version"]})`;
    case "tender_closed":
      return "closed bidding";
    case "awarded":
      return "awarded the tender";
    default:
      return e.kind.replace(/_/g, " ");
  }
}

export function ActivityFeed({ tenderId }: { tenderId: string }) {
  const q = useActivity(tenderId);
  return (
    <QueryState
      query={q}
      skeleton={<SkeletonRows rows={6} label="Loading activity" />}
      isEmpty={(d) => d.length === 0}
      empty={<EmptyState title="No activity yet" />}
    >
      {(data) => (
        <ol className={styles.feed} aria-live="polite" data-cy="activity">
          <AnimatePresence initial={false}>
            {[...data].reverse().map((e) => (
              <motion.li
                key={e.id}
                className={styles.item}
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                transition={{ duration: m.base, ease: m.ease }}
              >
                <span className={styles.time}>{formatTime(e.at)}</span>
                <span>
                  <span className={styles.actor}>{e.actor}</span> {describe(e)}
                </span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </QueryState>
  );
}
