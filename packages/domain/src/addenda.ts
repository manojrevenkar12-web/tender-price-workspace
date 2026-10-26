/**
 * Addenda: the bill of quantities changes while bids are being written.
 *
 * Positions are identified by their OZ. Between two versions a position can be added, removed,
 * get a new quantity (the bidder's unit price still holds: under VOB a unit-price contract pays
 * the price times the quantity) or get a new text or unit (the work changed: the old price does
 * not hold until the bidder confirms it). A bid always records the version it priced, so the
 * comparison can say exactly which of its prices still stand.
 */

export interface VersionedPosition {
  oz: string;
  shortText: string;
  longText: string;
  unit: string;
  quantity: number;
  kind: string;
}

export type Change =
  | { oz: string; type: "added" }
  | { oz: string; type: "removed" }
  | { oz: string; type: "quantity"; from: number; to: number }
  | { oz: string; type: "work"; fields: ("text" | "unit" | "kind")[] };

const hashes = new WeakMap<object, string>();

/** What a position is, as far as its price is concerned (memoised per position object). */
export function workHash(p: Pick<VersionedPosition, "shortText" | "longText" | "unit" | "kind">): string {
  let h = hashes.get(p);
  if (h === undefined) {
    h = hash53([p.shortText.trim(), p.longText.trim(), p.unit.trim().toLowerCase(), p.kind].join("\u0000"));
    hashes.set(p, h);
  }
  return h;
}

/** cyrb53: a fast 53-bit string hash that runs the same in Node and the browser. */
export function hash53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

export function diffVersions(
  before: readonly VersionedPosition[],
  after: readonly VersionedPosition[],
): Change[] {
  const old = new Map(before.map((p) => [p.oz, p]));
  const now = new Map(after.map((p) => [p.oz, p]));
  const changes: Change[] = [];
  for (const p of after) {
    const o = old.get(p.oz);
    if (!o) {
      changes.push({ oz: p.oz, type: "added" });
      continue;
    }
    const fields: ("text" | "unit" | "kind")[] = [];
    if (o.shortText.trim() !== p.shortText.trim() || o.longText.trim() !== p.longText.trim())
      fields.push("text");
    if (o.unit.trim().toLowerCase() !== p.unit.trim().toLowerCase()) fields.push("unit");
    if (o.kind !== p.kind) fields.push("kind");
    if (fields.length) changes.push({ oz: p.oz, type: "work", fields });
    else if (o.quantity !== p.quantity)
      changes.push({ oz: p.oz, type: "quantity", from: o.quantity, to: p.quantity });
  }
  for (const p of before) if (!now.has(p.oz)) changes.push({ oz: p.oz, type: "removed" });
  return changes.sort((a, b) => a.oz.localeCompare(b.oz, "en", { numeric: true }));
}

export type PriceStanding = "current" | "requantified" | "stale" | "missing";

/**
 * Whether a bid's price for a position of the current version still stands, given the version
 * the bid priced. `requantified` prices stand (the total is recomputed); `stale` ones were for
 * different work; `missing` positions were added after the bid or never priced.
 */
export function priceStanding(
  current: VersionedPosition,
  priced: VersionedPosition | undefined,
  hasPrice: boolean,
): PriceStanding {
  if (!priced || !hasPrice) return "missing";
  if (workHash(priced) !== workHash(current)) return "stale";
  return priced.quantity === current.quantity ? "current" : "requantified";
}
