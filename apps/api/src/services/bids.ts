/**
 * The bidder's side: open the tender, write prices (autosaved, with optimistic concurrency so two
 * colleagues editing the same bid cannot overwrite each other silently), submit, revise until the
 * deadline, or decline. A GAEB X84 file can be uploaded instead of typing prices.
 */
import { type Cents, parseGaeb, workHash } from "@tpw/domain";

import type { Db } from "../db.ts";
import { event, getTender, HttpError, notFound, positions, type TenderRow } from "./tenders.ts";

export interface BidView {
  id: string;
  tenderId: string;
  status: "draft" | "submitted" | "withdrawn";
  version: number;
  currentVersion: number;
  revision: number;
  submittedAt: string | null;
  prices: Record<string, number>;
}

async function invitation(
  db: Db,
  orgId: string,
  tenderId: string,
): Promise<{ t: TenderRow; status: string }> {
  const t = await getTender(db, tenderId);
  const i = await db.query<{ status: string }>(
    "SELECT status FROM invitations WHERE tender_id = $1 AND org_id = $2",
    [tenderId, orgId],
  );
  if (!i.rows[0]) throw notFound("invitation");
  return { t, status: i.rows[0].status };
}

function assertOpen(t: TenderRow): void {
  if (t.status !== "open") throw new HttpError(409, "tender_not_open", `the tender is ${t.status}`);
  if (t.deadline && t.deadline.getTime() < Date.now())
    throw new HttpError(409, "deadline_passed", "the deadline has passed");
}

export async function view(db: Db, orgId: string, tenderId: string): Promise<BidView | null> {
  const { t, status } = await invitation(db, orgId, tenderId);
  if (status === "invited") {
    await db.query(
      "UPDATE invitations SET status = 'viewed', updated_at = now() WHERE tender_id = $1 AND org_id = $2",
      [tenderId, orgId],
    );
    await event(db, tenderId, orgId, "viewed", {});
  }
  const b = await db.query("SELECT * FROM bids WHERE tender_id = $1 AND org_id = $2", [tenderId, orgId]);
  const bid = b.rows[0];
  if (!bid) return null;
  const items = await db.query<{ oz: string; unit_price_cents: number }>(
    "SELECT oz, unit_price_cents FROM bid_items WHERE bid_id = $1",
    [bid.id],
  );
  return {
    id: bid.id,
    tenderId,
    status: bid.status,
    version: bid.version,
    currentVersion: t.current_version,
    revision: bid.revision,
    submittedAt: bid.submitted_at?.toISOString() ?? null,
    prices: Object.fromEntries(items.rows.map((r) => [r.oz, r.unit_price_cents])),
  };
}

/**
 * Moves a bid from the BoQ version it priced to the current one. Prices for work that changed
 * (text, unit or kind) or was removed are dropped: the bidder must price them again. Prices for
 * positions whose quantity changed stand. Returns the OZ of dropped prices.
 */
async function rebase(db: Db, bidId: string, tenderId: string, from: number, to: number): Promise<string[]> {
  if (from === to) return [];
  const old = new Map((await positions(db, tenderId, from)).map((p) => [p.oz, workHash(p)]));
  const now = new Map((await positions(db, tenderId, to)).map((p) => [p.oz, workHash(p)]));
  const dropped = [...old.keys()].filter((oz) => now.get(oz) !== old.get(oz));
  if (dropped.length)
    await db.query("DELETE FROM bid_items WHERE bid_id = $1 AND oz = ANY($2::text[])", [bidId, dropped]);
  await db.query("UPDATE bids SET version = $2 WHERE id = $1", [bidId, to]);
  return dropped;
}

export interface SaveItems {
  /** The revision the client last saw; a different current revision is a conflict. */
  revision: number;
  prices: Record<string, number | null>;
}

export async function save(db: Db, orgId: string, tenderId: string, input: SaveItems): Promise<BidView> {
  const { t } = await invitation(db, orgId, tenderId);
  assertOpen(t);
  const valid = new Set((await positions(db, tenderId, t.current_version)).map((p) => p.oz));
  for (const [oz, price] of Object.entries(input.prices)) {
    if (!valid.has(oz))
      throw new HttpError(422, "unknown_position", `OZ ${oz} is not in version ${t.current_version}`);
    if (price !== null && (!Number.isSafeInteger(price) || price < 0))
      throw new HttpError(422, "invalid_price", `OZ ${oz}: price must be whole cents, 0 or more`);
  }
  let bid = (
    await db.query(
      "SELECT id, revision, version, status FROM bids WHERE tender_id = $1 AND org_id = $2 FOR UPDATE",
      [tenderId, orgId],
    )
  ).rows[0];
  if (!bid) {
    if (input.revision !== 0)
      throw new HttpError(409, "revision_conflict", "the bid was changed elsewhere; reload it");
    bid = (
      await db.query(
        "INSERT INTO bids (tender_id, org_id, version) VALUES ($1, $2, $3) RETURNING id, revision",
        [tenderId, orgId, t.current_version],
      )
    ).rows[0];
  } else if (bid.revision !== input.revision) {
    throw new HttpError(409, "revision_conflict", "the bid was changed elsewhere; reload it");
  } else {
    const dropped = await rebase(db, bid.id, tenderId, bid.version, t.current_version);
    if (dropped.length)
      await event(db, tenderId, orgId, "bid_rebased", { from: bid.version, to: t.current_version, dropped });
  }
  const set = Object.entries(input.prices).filter(([, p]) => p !== null) as [string, number][];
  const cleared = Object.entries(input.prices)
    .filter(([, p]) => p === null)
    .map(([oz]) => oz);
  if (set.length)
    await db.query(
      `INSERT INTO bid_items (bid_id, oz, unit_price_cents) SELECT $1, oz, p FROM unnest($2::text[], $3::bigint[]) AS x(oz, p)
       ON CONFLICT (bid_id, oz) DO UPDATE SET unit_price_cents = EXCLUDED.unit_price_cents`,
      [bid.id, set.map(([oz]) => oz), set.map(([, p]) => p)],
    );
  if (cleared.length)
    await db.query("DELETE FROM bid_items WHERE bid_id = $1 AND oz = ANY($2::text[])", [bid.id, cleared]);
  if (bid.status === "submitted") {
    // Changing a submitted bid takes it back to draft: the buyer sees it again once resubmitted.
    await db.query("UPDATE bids SET status = 'draft' WHERE id = $1", [bid.id]);
    await db.query(
      "UPDATE invitations SET status = 'viewed', updated_at = now() WHERE tender_id = $1 AND org_id = $2",
      [tenderId, orgId],
    );
    await event(db, tenderId, orgId, "bid_reopened", {});
  }
  await db.query("UPDATE bids SET revision = revision + 1, updated_at = now() WHERE id = $1", [bid.id]);
  return (await view(db, orgId, tenderId))!;
}

export interface SubmitProblem {
  oz: string;
  problem: "missing_price";
}

/** Submits (or resubmits) the bid. Every position that carries a total must be priced. */
export async function submit(db: Db, orgId: string, tenderId: string, revision: number): Promise<BidView> {
  const { t } = await invitation(db, orgId, tenderId);
  assertOpen(t);
  const b = (
    await db.query("SELECT id, revision, version FROM bids WHERE tender_id = $1 AND org_id = $2 FOR UPDATE", [
      tenderId,
      orgId,
    ])
  ).rows[0];
  if (!b) throw new HttpError(422, "empty_bid", "there are no prices to submit");
  if (b.revision !== revision)
    throw new HttpError(409, "revision_conflict", "the bid was changed elsewhere; reload it");
  await rebase(db, b.id, tenderId, b.version, t.current_version);
  const pos = await positions(db, tenderId, t.current_version);
  const priced = new Set(
    (await db.query<{ oz: string }>("SELECT oz FROM bid_items WHERE bid_id = $1", [b.id])).rows.map(
      (r) => r.oz,
    ),
  );
  const missing = pos
    .filter((p) => (p.kind === "normal" || p.kind === "lump") && !priced.has(p.oz))
    .map((p) => p.oz);
  if (missing.length) {
    const err = new HttpError(422, "incomplete_bid", `${missing.length} positions have no price`);
    (err as HttpError & { details: unknown }).details = missing.map((oz) => ({
      oz,
      problem: "missing_price",
    }));
    throw err;
  }
  await db.query(
    "UPDATE bids SET status = 'submitted', version = $2, submitted_at = now(), revision = revision + 1, updated_at = now() WHERE id = $1",
    [b.id, t.current_version],
  );
  await db.query(
    "UPDATE invitations SET status = 'submitted', updated_at = now() WHERE tender_id = $1 AND org_id = $2",
    [tenderId, orgId],
  );
  await event(db, tenderId, orgId, "bid_submitted", { version: t.current_version });
  return (await view(db, orgId, tenderId))!;
}

export async function decline(db: Db, orgId: string, tenderId: string, reason: string): Promise<void> {
  const { status } = await invitation(db, orgId, tenderId);
  if (status === "submitted")
    throw new HttpError(409, "already_submitted", "withdraw is not supported after submission");
  await db.query(
    "UPDATE invitations SET status = 'declined', updated_at = now() WHERE tender_id = $1 AND org_id = $2",
    [tenderId, orgId],
  );
  await event(db, tenderId, orgId, "declined", { reason });
}

/** Reads an X84 file into the bid (as a save; submitting is a separate, deliberate step). */
export async function importX84(
  db: Db,
  orgId: string,
  tenderId: string,
  xml: string,
  revision: number,
): Promise<{ bid: BidView; ignored: string[] }> {
  const boq = parseGaeb(xml);
  if (boq.dp !== 84) throw new HttpError(422, "not_x84", `this is a DP ${boq.dp} file; a bid is DP 84`);
  const { t } = await invitation(db, orgId, tenderId);
  const valid = new Set((await positions(db, tenderId, t.current_version)).map((p) => p.oz));
  const prices: Record<string, number> = {};
  const ignored: string[] = [];
  for (const [oz, p] of boq.prices ?? new Map<string, Cents>()) {
    if (valid.has(oz)) prices[oz] = p;
    else ignored.push(oz);
  }
  return { bid: await save(db, orgId, tenderId, { revision, prices }), ignored };
}
