/**
 * The price comparison for a tender, built from the database and decided by domain/compare.
 * Only submitted bids are included (row-level security would hide drafts anyway).
 */
import { type BidInput, type Cents, type Comparison, compare, type MarketRange } from "@tpw/domain";

import type { Db } from "../db.ts";
import { ownTender, positions, type PositionRow } from "./tenders.ts";

export interface ComparisonView extends Comparison {
  tenderId: string;
  version: number;
  benchmarks: { ready: number; total: number };
  marketStatus: Record<string, { status: string; reason: string | null; companies: number }>;
}

export async function comparison(db: Db, orgId: string, tenderId: string): Promise<ComparisonView> {
  const t = await ownTender(db, orgId, tenderId);
  const current = await positions(db, tenderId, t.current_version);
  const bids = await db.query<{ id: string; version: number; name: string }>(
    `SELECT b.id, b.version, o.name FROM bids b JOIN organizations o ON o.id = b.org_id
      WHERE b.tender_id = $1 AND b.status = 'submitted' ORDER BY b.submitted_at`,
    [tenderId],
  );
  const items = await db.query<{ bid_id: string; oz: string; unit_price_cents: number }>(
    "SELECT i.bid_id, i.oz, i.unit_price_cents FROM bid_items i JOIN bids b ON b.id = i.bid_id WHERE b.tender_id = $1 AND b.status = 'submitted'",
    [tenderId],
  );
  const versions = new Map<number, Map<string, PositionRow>>();
  for (const v of new Set(bids.rows.map((b) => b.version))) {
    versions.set(
      v,
      new Map((v === t.current_version ? current : await positions(db, tenderId, v)).map((p) => [p.oz, p])),
    );
  }
  const prices = new Map<string, Map<string, Cents>>();
  for (const i of items.rows) {
    if (!prices.has(i.bid_id)) prices.set(i.bid_id, new Map());
    prices.get(i.bid_id)!.set(i.oz, i.unit_price_cents as Cents);
  }
  const inputs: BidInput[] = bids.rows.map((b) => ({
    bidId: b.id,
    bidder: b.name,
    pricedVersion: versions.get(b.version)!,
    prices: prices.get(b.id) ?? new Map(),
  }));
  const bm = await db.query<{
    oz: string;
    status: string;
    reason: string | null;
    p10: number | null;
    p50: number | null;
    p90: number | null;
    companies: number;
  }>(
    "SELECT oz, status, reason, p10, p50, p90, companies FROM position_benchmarks WHERE tender_id = $1 AND version = $2",
    [tenderId, t.current_version],
  );
  const markets = new Map<string, MarketRange>();
  const marketStatus: ComparisonView["marketStatus"] = {};
  for (const b of bm.rows) {
    marketStatus[b.oz] = { status: b.status, reason: b.reason, companies: b.companies };
    if (b.status === "ok") markets.set(b.oz, { p10: b.p10!, p50: b.p50!, p90: b.p90! });
  }
  return {
    tenderId,
    version: t.current_version,
    ...compare(current, inputs, markets),
    benchmarks: { ready: bm.rowCount ?? 0, total: current.length },
    marketStatus,
  };
}
