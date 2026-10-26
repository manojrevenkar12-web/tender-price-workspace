import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";

import type { Invitation, TenderDetail } from "../../shared/api/types";
import { motion as m } from "../../shared/theme/tokens";
import { Badge, Button, Dialog, EmptyState, Panel, SkeletonRows, type Tone, useToast } from "../../shared/ui";
import { useInvite, useOrganizations } from "./api";
import styles from "./InvitationsPanel.module.css";

const STATE: Record<Invitation["status"], { label: string; tone: Tone }> = {
  invited: { label: "Invited", tone: "neutral" },
  viewed: { label: "Opened", tone: "caution" },
  declined: { label: "Declined", tone: "stale" },
  submitted: { label: "Submitted", tone: "market" },
};

export function InvitationsPanel({ tender }: { tender: TenderDetail }) {
  const [open, setOpen] = useState(false);
  const canInvite = tender.status === "draft" || tender.status === "open";
  return (
    <Panel
      title="Bidders"
      id="bidders"
      actions={
        canInvite && (
          <Button size="small" onClick={() => setOpen(true)}>
            Invite
          </Button>
        )
      }
    >
      {tender.invitations.length === 0 ? (
        <EmptyState title="Nobody invited yet">
          Invite subcontractors from the directory; they see the tender once it is published.
        </EmptyState>
      ) : (
        <ul className={styles.list} aria-live="polite">
          <AnimatePresence initial={false}>
            {tender.invitations.map((i) => (
              <motion.li
                key={i.orgId}
                className={styles.item}
                layout
                transition={{ duration: m.base, ease: m.ease }}
              >
                <span>
                  <span className={styles.name}>{i.name}</span>
                  <span className={styles.region}>{i.region}</span>
                </span>
                <motion.span
                  key={i.status}
                  initial={{ scale: 0.85, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: m.base }}
                >
                  <Badge tone={STATE[i.status].tone}>{STATE[i.status].label}</Badge>
                </motion.span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <InviteDialog tender={tender} open={open} onClose={() => setOpen(false)} />
    </Panel>
  );
}

function InviteDialog({
  tender,
  open,
  onClose,
}: {
  tender: TenderDetail;
  open: boolean;
  onClose: () => void;
}) {
  const orgs = useOrganizations(tender.trade === "general" ? undefined : tender.trade);
  const invite = useInvite(tender.id);
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const already = new Set(tender.invitations.map((i) => i.orgId));
  const candidates = (orgs.data ?? []).filter((o) => !already.has(o.id));
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite subcontractors"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={chosen.size === 0}
            busy={invite.isPending}
            onClick={() =>
              invite.mutate([...chosen], {
                onSuccess: (r) => {
                  toast(`${r.invited} companies invited`);
                  setChosen(new Set());
                  onClose();
                },
              })
            }
          >
            Invite {chosen.size || ""}
          </Button>
        </>
      }
    >
      {orgs.isPending && <SkeletonRows rows={5} label="Loading directory" />}
      {orgs.isSuccess && candidates.length === 0 && (
        <p className={styles.muted}>Every company in this trade is already invited.</p>
      )}
      <div className={styles.picker}>
        {candidates.map((o) => (
          <label key={o.id} className={styles.option}>
            <input
              type="checkbox"
              checked={chosen.has(o.id)}
              onChange={(e) =>
                setChosen((s) => {
                  const n = new Set(s);
                  if (e.target.checked) n.add(o.id);
                  else n.delete(o.id);
                  return n;
                })
              }
            />
            <span>{o.name}</span>
            <span className={styles.muted}>{o.region}</span>
          </label>
        ))}
      </div>
    </Dialog>
  );
}
