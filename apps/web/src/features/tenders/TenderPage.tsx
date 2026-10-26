import { useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { authedUrl } from "../../shared/api/client";
import { formatDate, relativeDeadline } from "../../shared/lib/format";
import {
  Badge,
  Button,
  Dialog,
  ErrorState,
  PageHeader,
  Skeleton,
  SkeletonRows,
  Tabs,
  useToast,
} from "../../shared/ui";
import { ComparisonView } from "../comparison/ComparisonView";
import { ActivityFeed } from "./ActivityFeed";
import { useClose, usePublish, useTender, useLiveActivity } from "./api";
import { BoqView } from "./BoqView";
import { InvitationsPanel } from "./InvitationsPanel";
import { STATUS, TRADE_LABEL } from "./status";
import styles from "./TenderPage.module.css";

type Tab = "boq" | "comparison" | "activity";

export function TenderPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? "comparison";
  const q = useTender(id);
  useLiveActivity(id);
  const close = useClose(id);
  const toast = useToast();
  const [publishing, setPublishing] = useState(false);

  if (q.isPending)
    return (
      <div role="status" aria-label="Loading tender">
        <Skeleton width="40%" height="2.25rem" />
        <div style={{ height: "var(--space-5)" }} />
        <SkeletonRows rows={8} label="Loading positions" />
      </div>
    );
  if (q.isError)
    return (
      <ErrorState error={q.error} onRetry={() => void q.refetch()} title="This tender could not be loaded" />
    );
  const t = q.data;
  const submitted = t.invitations.filter((i) => i.status === "submitted").length;

  return (
    <>
      <PageHeader
        title={t.title}
        badge={<Badge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</Badge>}
        sub={
          <span className={styles.meta}>
            <span>
              <strong>{t.project.name}</strong>, {t.project.city}
            </span>
            <span>{TRADE_LABEL[t.trade] ?? t.trade}</span>
            <span>
              BoQ version <strong>{t.version}</strong>
            </span>
            {t.deadline && (
              <span>
                Deadline <strong>{formatDate(t.deadline)}</strong> ({relativeDeadline(t.deadline)})
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => window.open(authedUrl(`/api/tenders/${t.id}/gaeb`), "_blank")}
            >
              Download X83
            </Button>
            {t.status === "draft" && (
              <Button variant="primary" onClick={() => setPublishing(true)}>
                Publish
              </Button>
            )}
            {t.status === "open" && (
              <Button
                busy={close.isPending}
                onClick={() =>
                  close.mutate(undefined, {
                    onSuccess: () => toast("Tender closed. No more bids can be submitted."),
                  })
                }
              >
                Close bidding
              </Button>
            )}
          </>
        }
      />
      <Tabs
        label="Tender"
        value={tab}
        onChange={(k) => setParams({ tab: k }, { replace: true })}
        items={[
          { key: "comparison", label: "Price comparison", count: submitted },
          { key: "boq", label: "Bill of quantities", count: t.positions.length },
          { key: "activity", label: "Activity" },
        ]}
      />
      <div className={`${styles.layout} ${tab === "comparison" ? styles.wide : ""}`}>
        <div>
          {tab === "comparison" && <ComparisonView tender={t} />}
          {tab === "boq" && <BoqView tender={t} />}
          {tab === "activity" && <ActivityFeed tenderId={t.id} />}
        </div>
        {tab !== "comparison" && (
          <aside className={styles.side}>
            <InvitationsPanel tender={t} />
          </aside>
        )}
      </div>
      <PublishDialog id={t.id} open={publishing} onClose={() => setPublishing(false)} />
    </>
  );
}

function PublishDialog({ id, open, onClose }: { id: string; open: boolean; onClose: () => void }) {
  const publish = usePublish(id);
  const toast = useToast();
  const [date, setDate] = useState(() => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Publish tender"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={publish.isPending}
            onClick={() =>
              publish.mutate(new Date(`${date}T12:00:00Z`).toISOString(), {
                onSuccess: () => {
                  onClose();
                  toast("Published. Invited companies can now see it.");
                },
              })
            }
          >
            Publish
          </Button>
        </>
      }
    >
      <p>Invited companies see the tender and can price it until the deadline (12:00 UTC on the day).</p>
      <label className={styles.field}>
        Deadline
        <input className={styles.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      {publish.isError && (
        <p className={styles.error} role="alert">
          {publish.error.message}
        </p>
      )}
    </Dialog>
  );
}
