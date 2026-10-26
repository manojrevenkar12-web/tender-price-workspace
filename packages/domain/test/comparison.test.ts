import { describe, expect, it } from "vitest";

import { type BidInput, type Cents, cents, compare, flagsFor, type VersionedPosition } from "../src/index.ts";

const pos = (oz: string, quantity: number, over: Partial<VersionedPosition> = {}): VersionedPosition => ({
  oz,
  shortText: `Work ${oz}`,
  longText: "",
  unit: "m2",
  quantity,
  kind: "normal",
  ...over,
});

function bid(id: string, version: VersionedPosition[], prices: Record<string, number>): BidInput {
  return {
    bidId: id,
    bidder: `Bidder ${id}`,
    pricedVersion: new Map(version.map((p) => [p.oz, p])),
    prices: new Map(Object.entries(prices).map(([k, v]) => [k, cents(v) as Cents])),
  };
}

describe("flagsFor", () => {
  it("spots a decimal slip against the other bids", () => {
    expect(flagsFor(4_500, [45_000, 46_000, 44_000], null, 10)).toEqual(["decimal_slip"]);
    expect(flagsFor(460_000, [45_000, 46_000, 44_000], null, 10)).toEqual(["decimal_slip"]);
  });
  it("spots a price far from the others", () => {
    expect(flagsFor(90_000, [45_000, 46_000, 44_000, 45_500], null, 10)).toContain("outlier_high");
    expect(flagsFor(46_500, [45_000, 46_000, 44_000, 45_500], null, 10)).toEqual([]);
  });
  it("compares with the market when there is one", () => {
    expect(flagsFor(13_000, [12_900], { p10: 9_000, p50: 10_000, p90: 11_000 }, 10)).toEqual([
      "above_market",
    ]);
  });
  it("flags zero for work with a quantity", () => {
    expect(flagsFor(0, [100], null, 3)).toEqual(["zero_price"]);
  });
});

describe("compare", () => {
  const v1 = [pos("01", 100), pos("02", 10), pos("03", 5, { kind: "optional" })];
  const v2 = [
    pos("01", 120),
    pos("02", 10, { shortText: "Work 02, thicker" }),
    pos("03", 5, { kind: "optional" }),
    pos("04", 1),
  ];

  const a = bid("a", v2, { "01": 1_000, "02": 5_000, "03": 900, "04": 20_000 });
  const b = bid("b", v1, { "01": 1_100, "02": 4_000, "03": 800 }); // priced the old version
  const c = bid("c", v2, { "01": 1_050, "02": 5_200, "04": 22_000 });

  const cmp = compare(v2, [a, b, c]);

  it("keeps requantified prices, refuses stale ones, and knows what was never priced", () => {
    const row = (oz: string) => cmp.rows.find((r) => r.oz === oz)!;
    expect(row("01").cells["b"]).toMatchObject({
      standing: "requantified",
      unitPrice: 1_100,
      total: 132_000,
    });
    expect(row("02").cells["b"]).toMatchObject({ standing: "stale", total: null, flags: ["stale"] });
    expect(row("04").cells["b"]).toMatchObject({ standing: "missing", flags: ["missing"] });
    expect(row("03").cells["c"]).toMatchObject({ standing: "missing" });
  });

  it("totals only positions that carry a total", () => {
    const sa = cmp.bids.find((s) => s.bidId === "a")!;
    // 01: 10 € x 120 + 02: 50 € x 10 + 04: 200 € x 1; optional 03 is not in the total
    expect(sa.total).toBe(120_000 + 50_000 + 20_000);
  });

  it("ranks by a comparable total that fills gaps with the others' median", () => {
    const sb = cmp.bids.find((s) => s.bidId === "b")!;
    // b's own: 01 = 132,000; 02 stale -> median(5,000, 5,200)=5,100 x 10 = 51,000; 04 missing -> 21,000
    expect(sb.total).toBe(132_000);
    expect(sb.comparableTotal).toBe(132_000 + 51_000 + 21_000);
    expect(sb).toMatchObject({ missing: 1, stale: 1 });
    // c: 126,000 + 52,000 + 22,000 = 200,000 (its gap is optional work, outside the total)
    expect(cmp.bids.map((s) => [s.bidId, s.comparableTotal, s.rank])).toEqual([
      ["a", 190_000, 1],
      ["b", 204_000, 3],
      ["c", 200_000, 2],
    ]);
  });
});

describe("compare on a large row", () => {
  it("flags slips and outliers with row statistics when there are many bids", () => {
    const p = [pos("01", 10)];
    const prices = [10_000, 10_200, 9_900, 10_100, 9_800, 10_300, 10_050, 9_950, 1_000, 30_000];
    const bs = prices.map((v, i) => bid(String(i), p, { "01": v }));
    const row = compare(p, bs).rows[0]!;
    expect(row.cells["8"]!.flags).toEqual(["decimal_slip"]);
    expect(row.cells["9"]!.flags).toEqual(["outlier_high"]);
    expect(Object.values(row.cells).filter((c) => c.flags.length).length).toBe(2);
  });
});
