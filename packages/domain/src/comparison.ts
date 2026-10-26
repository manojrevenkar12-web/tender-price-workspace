/**
 * The price comparison (Preisspiegel): every bid against every position of the current bill of
 * quantities, with what a buyer needs to see before awarding.
 *
 * Flags are decided by rules a buyer can check by hand:
 *  - missing / stale      the bid has no price for this work (see addenda.ts)
 *  - decimal_slip         the price is 10x or 1/10 of the other bids' median (within 25%)
 *  - outlier_high/low     more than 3.5 robust z-scores from the other bids (needs 3 others;
 *                         from 8 bids on the row's median and spread include the price itself)
 *  - above/below_market   outside the market range (p10..p90 of comparable history, ±10%)
 *  - zero_price           a price of 0 for work with a quantity
 *
 * Bid totals count the positions that carry a total (normal and lump sum, not optional or
 * alternative). Because a bid with gaps looks cheaper than it is, each bid also gets a
 * comparable total in which every missing or stale price is filled with the median of the
 * other bids for that position; ranking uses the comparable total.
 */
import { type PriceStanding, priceStanding, type VersionedPosition } from "./addenda.ts";
import { type Cents, cents, lineTotal } from "./money.ts";

export type Flag =
  | "missing"
  | "stale"
  | "decimal_slip"
  | "outlier_high"
  | "outlier_low"
  | "above_market"
  | "below_market"
  | "zero_price";

export interface MarketRange {
  p10: number;
  p50: number;
  p90: number;
}

export interface BidInput {
  bidId: string;
  bidder: string;
  /** Positions of the BoQ version the bid priced, by OZ. */
  pricedVersion: ReadonlyMap<string, VersionedPosition>;
  prices: ReadonlyMap<string, Cents>;
}

export interface Cell {
  unitPrice: Cents | null;
  total: Cents | null;
  standing: PriceStanding;
  flags: Flag[];
}

export interface Row {
  oz: string;
  shortText: string;
  unit: string;
  quantity: number;
  kind: string;
  cells: Record<string, Cell>;
  median: number | null;
  min: number | null;
  max: number | null;
  market: MarketRange | null;
}

export interface BidSummary {
  bidId: string;
  bidder: string;
  total: Cents;
  comparableTotal: Cents;
  missing: number;
  stale: number;
  flagged: number;
  rank: number;
}

export interface Comparison {
  rows: Row[];
  bids: BidSummary[];
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

const carriesTotal = (kind: string) => kind === "normal" || kind === "lump";

function sortedMedian(s: readonly number[]): number | null {
  if (s.length === 0) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Flags for one price against the other bids' prices (`others`, sorted ascending when
 * `sorted` is true: the comparison passes them sorted so no cell sorts twice).
 */
export interface RowStats {
  median: number;
  logMedian: number;
  logMad: number;
  n: number;
}

/** Robust statistics of a row's prices (sorted ascending, all > 0). */
export function rowStats(sortedPositive: readonly number[]): RowStats | null {
  if (sortedPositive.length === 0) return null;
  const median = sortedMedian(sortedPositive)!;
  const logMedian = Math.log(median);
  const dev = new Float64Array(sortedPositive.length);
  for (let i = 0; i < sortedPositive.length; i++) dev[i] = Math.abs(Math.log(sortedPositive[i]!) - logMedian);
  dev.sort();
  const m = dev.length >> 1;
  const logMad = dev.length % 2 ? dev[m]! : (dev[m - 1]! + dev[m]!) / 2;
  return { median, logMedian, logMad, n: sortedPositive.length };
}

export function flagsFor(
  price: number,
  others: readonly number[],
  market: MarketRange | null,
  quantity: number,
  sorted = false,
  stats?: RowStats | null,
): Flag[] {
  const flags: Flag[] = [];
  if (price === 0) {
    if (quantity > 0) flags.push("zero_price");
    return flags;
  }
  if (stats) return flagsFromStats(price, stats, market, flags);
  const s = sorted ? others : [...others].sort((a, b) => a - b);
  const med = sortedMedian(s);
  if (med !== null && med > 0) {
    const r = price / med;
    if ((r >= 7.5 && r <= 12.5) || (r >= 0.08 && r <= 0.1333)) flags.push("decimal_slip");
  }
  if (s.length >= 3 && !flags.includes("decimal_slip")) {
    const positive = s.filter((x) => x > 0);
    if (positive.length >= 3) {
      // Logs of sorted values are sorted: the median needs no sort, the spread one.
      const m = Math.log(sortedMedian(positive)!);
      const dev = new Float64Array(positive.length);
      for (let i = 0; i < positive.length; i++) dev[i] = Math.abs(Math.log(positive[i]!) - m);
      dev.sort();
      const mad = sortedMedian(Array.from(dev))!;
      const z = (0.6745 * (Math.log(price) - m)) / Math.max(mad, 0.05);
      if (z > 3.5) flags.push("outlier_high");
      else if (z < -3.5) flags.push("outlier_low");
    }
  }
  if (market) {
    if (price > market.p90 * 1.1) flags.push("above_market");
    else if (price < market.p10 * 0.9) flags.push("below_market");
  }
  return flags;
}

function flagsFromStats(price: number, st: RowStats, market: MarketRange | null, flags: Flag[]): Flag[] {
  const r = price / st.median;
  if ((r >= 7.5 && r <= 12.5) || (r >= 0.08 && r <= 0.1333)) flags.push("decimal_slip");
  else if (st.n >= 3) {
    const z = (0.6745 * (Math.log(price) - st.logMedian)) / Math.max(st.logMad, 0.05);
    if (z > 3.5) flags.push("outlier_high");
    else if (z < -3.5) flags.push("outlier_low");
  }
  if (market) {
    if (price > market.p90 * 1.1) flags.push("above_market");
    else if (price < market.p10 * 0.9) flags.push("below_market");
  }
  return flags;
}

/** From this many bids on, one price barely moves the row's median and spread: compute them once. */
const ROW_STATS_FROM = 8;

export function compare(
  current: readonly VersionedPosition[],
  bids: readonly BidInput[],
  markets: ReadonlyMap<string, MarketRange> = new Map(),
): Comparison {
  const rows: Row[] = [];
  const totals = new Map(
    bids.map((b) => [b.bidId, { total: 0, comparable: 0, missing: 0, stale: 0, flagged: 0 }]),
  );

  for (const pos of current) {
    const standing = new Map<string, PriceStanding>();
    const valid = new Map<string, Cents>();
    for (const b of bids) {
      const s = priceStanding(pos, b.pricedVersion.get(pos.oz), b.prices.has(pos.oz));
      standing.set(b.bidId, s);
      if (s === "current" || s === "requantified") valid.set(b.bidId, b.prices.get(pos.oz)!);
    }
    const market = markets.get(pos.oz) ?? null;
    const prices = [...valid.values()].filter((p) => p > 0);
    const med = median(prices);
    const all = [...valid.values()].sort((a, b) => a - b);
    const stats = all.length >= ROW_STATS_FROM ? rowStats(all.filter((x) => x > 0)) : null;
    const cells: Record<string, Cell> = {};
    for (const b of bids) {
      const s = standing.get(b.bidId)!;
      const t = totals.get(b.bidId)!;
      const price = valid.get(b.bidId);
      if (price === undefined) {
        cells[b.bidId] = {
          unitPrice: s === "stale" ? (b.prices.get(pos.oz) ?? null) : null,
          total: null,
          standing: s,
          flags: [s === "stale" ? "stale" : "missing"],
        };
        if (s === "stale") t.stale++;
        else t.missing++;
        t.flagged++;
        if (carriesTotal(pos.kind) && med !== null)
          t.comparable += lineTotal(cents(Math.round(med)), pos.quantity);
        continue;
      }
      let flags: Flag[];
      if (stats) flags = flagsFor(price, [], market, pos.quantity, true, stats);
      else {
        // Few bids: compare with the others only (the row's sorted prices without this one).
        const others = all.slice();
        others.splice(others.indexOf(price), 1);
        flags = flagsFor(price, others, market, pos.quantity, true);
      }
      const total = carriesTotal(pos.kind) ? lineTotal(price, pos.quantity) : null;
      if (total !== null) {
        t.total += total;
        t.comparable += total;
      }
      if (flags.length) t.flagged++;
      cells[b.bidId] = { unitPrice: price, total, standing: s, flags };
    }
    rows.push({
      oz: pos.oz,
      shortText: pos.shortText,
      unit: pos.unit,
      quantity: pos.quantity,
      kind: pos.kind,
      cells,
      median: med,
      min: prices.length ? Math.min(...prices) : null,
      max: prices.length ? Math.max(...prices) : null,
      market,
    });
  }

  const summaries: BidSummary[] = bids.map((b) => {
    const t = totals.get(b.bidId)!;
    return {
      bidId: b.bidId,
      bidder: b.bidder,
      total: cents(t.total),
      comparableTotal: cents(t.comparable),
      missing: t.missing,
      stale: t.stale,
      flagged: t.flagged,
      rank: 0,
    };
  });
  [...summaries]
    .sort((a, b) => a.comparableTotal - b.comparableTotal || a.bidder.localeCompare(b.bidder))
    .forEach((s, i) => (s.rank = i + 1));
  return { rows, bids: summaries };
}
