import { motion } from "framer-motion";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { formatTime, relativeDeadline } from "../../shared/lib/format";
import { motion as m } from "../../shared/theme/tokens";
import { Badge, Button, EmptyState, PageHeader, QueryState, SkeletonRows } from "../../shared/ui";
import { useTenders } from "./api";
import { NewTenderDialog } from "./NewTenderDialog";
import { STATUS, TRADE_LABEL } from "./status";
import styles from "./TenderListPage.module.css";

export function TenderListPage() {
  const tenders = useTenders();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  return (
    <>
      <PageHeader
        title="Tenders"
        sub="Packages you have put out to bid, with how far each one is."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New tender from GAEB
          </Button>
        }
      />
      <QueryState
        query={tenders}
        skeleton={<SkeletonRows rows={5} height="3.5rem" label="Loading tenders" />}
        isEmpty={(d) => d.length === 0}
        empty={
          <EmptyState
            title="No tenders yet"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Upload a GAEB X83
              </Button>
            }
          >
            A tender starts from a bill of quantities. Upload the X83 file your estimating software exports
            and invite subcontractors to price it.
          </EmptyState>
        }
      >
        {(data) => (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Tender</th>
                <th className={styles.hideNarrow}>Trade</th>
                <th>Status</th>
                <th>Bids</th>
                <th className={`${styles.right} ${styles.hideNarrow}`}>Positions</th>
                <th className={styles.hideNarrow}>Last activity</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t, i) => (
                <motion.tr
                  key={t.id}
                  className={styles.row}
                  onClick={() => navigate(`/tenders/${t.id}`)}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: m.base, delay: i * m.stagger, ease: m.ease }}
                >
                  <td>
                    <Link
                      to={`/tenders/${t.id}`}
                      className={styles.title}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {t.title}
                    </Link>
                    <span className={styles.project}>
                      {t.project}, {t.city}
                    </span>
                  </td>
                  <td className={styles.hideNarrow}>{TRADE_LABEL[t.trade] ?? t.trade}</td>
                  <td>
                    <Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>
                    {t.status === "open" && (
                      <span className={`${styles.small}`}> {relativeDeadline(t.deadline)}</span>
                    )}
                  </td>
                  <td>
                    <div
                      className={styles.progress}
                      aria-label={`${t.submitted} of ${t.invited} invited companies submitted`}
                    >
                      <span className="num">
                        {t.submitted} of {t.invited} submitted
                      </span>
                      <span className={styles.track}>
                        <span
                          className={styles.fill}
                          style={{ width: `${t.invited ? (100 * t.submitted) / t.invited : 0}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className={`${styles.right} num ${styles.hideNarrow}`}>
                    {t.positions.toLocaleString("de-DE")}
                  </td>
                  <td className={`${styles.small} ${styles.hideNarrow}`}>{formatTime(t.updatedAt)}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        )}
      </QueryState>
      <NewTenderDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
