import { diffVersions, type Change } from "@tpw/domain";
import { useQuery } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";

import { api } from "../../shared/api/client";
import type { Position, TenderDetail } from "../../shared/api/types";
import { formatQuantity } from "../../shared/lib/format";
import { Badge, Button, Dialog, ErrorState, SkeletonRows, useToast } from "../../shared/ui";
import { useAddendum, useDiff, useVersion } from "./api";
import styles from "./BoqView.module.css";

const KIND: Record<string, string> = { optional: "Optional", alternative: "Alternative", lump: "Lump sum" };

export function BoqView({ tender }: { tender: TenderDetail }) {
  const [version, setVersion] = useState(tender.version);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, { quantity?: string; shortText?: string }>>({});
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState("");
  const toast = useToast();
  const current = version === tender.version;
  const older = useVersion(tender.id, version, !current);
  const diff = useDiff(tender.id, version - 1, version, version > 1);
  const review = useQuery({
    queryKey: ["review", tender.id, tender.version],
    queryFn: () =>
      api.get<{ oz: string; findings: { code: string; message: string }[] }[]>(
        `/api/tenders/${tender.id}/review`,
      ),
  });
  const addendum = useAddendum(tender.id);
  const positions = current ? tender.positions : older.data;
  const findings = useMemo(() => new Map(review.data?.map((r) => [r.oz, r.findings]) ?? []), [review.data]);
  const changes = useMemo(() => new Map((diff.data ?? []).map((c) => [c.oz, c])), [diff.data]);

  const next = useMemo(
    () =>
      tender.positions.map((p) => {
        const d = draft[p.oz];
        const q = d?.quantity !== undefined ? Number(d.quantity.replace(",", ".")) : p.quantity;
        return {
          ...p,
          quantity: Number.isFinite(q) ? q : p.quantity,
          shortText: d?.shortText ?? p.shortText,
        };
      }),
    [draft, tender.positions],
  );
  const pending: Change[] = useMemo(
    () => (editing ? diffVersions(tender.positions, next) : []),
    [editing, tender.positions, next],
  );
  const canAmend = tender.status === "open" || tender.status === "draft";

  if (!current && older.isPending) return <SkeletonRows rows={8} label="Loading version" />;
  if (!current && older.isError)
    return <ErrorState error={older.error} onRetry={() => void older.refetch()} />;

  const rows = (positions ?? []).map((p: Position, i, all) => {
    const section = p.section.join(" / ");
    return { p, section, showSection: section !== "" && section !== (all[i - 1]?.section.join(" / ") ?? "") };
  });
  return (
    <>
      <div className={styles.bar}>
        <div className={styles.versions}>
          <label htmlFor="version">Version</label>
          <select
            id="version"
            className={styles.select}
            value={version}
            onChange={(e) => setVersion(Number(e.target.value))}
            disabled={editing}
          >
            {tender.versions.map((v) => (
              <option key={v.version} value={v.version}>
                {v.version} {v.note ? `– ${v.note.slice(0, 40)}` : v.source === "gaeb" ? "– from GAEB" : ""}
              </option>
            ))}
          </select>
          {version > 1 && diff.data && (
            <Badge tone="stale">
              {diff.data.length} changes against version {version - 1}
            </Badge>
          )}
        </div>
        {current && canAmend && !editing && tender.status === "open" && (
          <Button onClick={() => setEditing(true)} data-cy="prepare-addendum">
            Prepare addendum
          </Button>
        )}
        {editing && (
          <div className={styles.versions}>
            <Button variant="ghost" onClick={() => (setEditing(false), setDraft({}))}>
              Discard
            </Button>
            <Button variant="primary" disabled={pending.length === 0} onClick={() => setConfirm(true)}>
              Review {pending.length} changes
            </Button>
          </div>
        )}
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>OZ</th>
            <th>Position</th>
            <th className={styles.num}>Quantity</th>
            <th>Unit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, section, showSection }) => {
            const change = changes.get(p.oz);
            const f = current ? findings.get(p.oz) : undefined;
            return (
              <Fragment key={p.oz}>
                {showSection && (
                  <tr className={styles.section}>
                    <td colSpan={4}>{section}</td>
                  </tr>
                )}
                <tr
                  className={change ? (change.type === "added" ? styles.added : styles.changed) : ""}
                  data-oz={p.oz}
                >
                  <td className={styles.oz}>{p.oz}</td>
                  <td>
                    {editing ? (
                      <input
                        className={styles.edit}
                        aria-label={`Short text ${p.oz}`}
                        value={draft[p.oz]?.shortText ?? p.shortText}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [p.oz]: { ...d[p.oz], shortText: e.target.value } }))
                        }
                      />
                    ) : (
                      <>
                        {p.shortText} {KIND[p.kind] && <Badge>{KIND[p.kind]}</Badge>}
                        {p.longText && <span className={styles.long}>{p.longText}</span>}
                      </>
                    )}
                    {f && (
                      <ul className={styles.findings}>
                        {f.map((x) => (
                          <li key={x.code}>{x.message}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={styles.num}>
                    {editing ? (
                      <input
                        className={`${styles.edit} ${styles.qtyEdit}`}
                        aria-label={`Quantity ${p.oz}`}
                        inputMode="decimal"
                        value={draft[p.oz]?.quantity ?? String(p.quantity).replace(".", ",")}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [p.oz]: { ...d[p.oz], quantity: e.target.value } }))
                        }
                      />
                    ) : (
                      formatQuantity(p.quantity)
                    )}
                  </td>
                  <td>{p.unit}</td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={`Publish addendum (version ${tender.version + 1})`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Back
            </Button>
            <Button
              variant="primary"
              busy={addendum.isPending}
              onClick={() =>
                addendum.mutate(
                  {
                    note,
                    positions: next.map(({ oz, section, shortText, longText, unit, quantity, kind }) => ({
                      oz,
                      section,
                      shortText,
                      longText,
                      unit,
                      quantity,
                      kind,
                    })),
                  },
                  {
                    onSuccess: (r) => {
                      setConfirm(false);
                      setEditing(false);
                      setDraft({});
                      setVersion(r.version);
                      toast(
                        `Version ${r.version} published. ${r.biddersAffected} submitted bids will show which prices no longer stand.`,
                      );
                    },
                    onError: (e) => toast(e.message, "error"),
                  },
                )
              }
            >
              Publish to bidders
            </Button>
          </>
        }
      >
        <ul className={styles.diff}>
          {pending.map((c) => (
            <li key={c.oz}>
              <strong className="num">{c.oz}</strong>{" "}
              {c.type === "quantity"
                ? `quantity ${formatQuantity(c.from)} to ${formatQuantity(c.to)}: submitted prices stand`
                : c.type === "work"
                  ? "text changed: bidders must price it again"
                  : c.type}
            </li>
          ))}
        </ul>
        <label>
          Note to bidders
          <textarea
            className={styles.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What changed and why"
          />
        </label>
      </Dialog>
    </>
  );
}
