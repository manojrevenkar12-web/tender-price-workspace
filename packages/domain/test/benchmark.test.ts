import { describe, expect, it } from "vitest";

import {
  type Adjustment,
  adjust,
  benchmark,
  type PricePoint,
  publishRound,
  quarterOf,
  weightedQuantile,
} from "../src/index.ts";

const adj: Adjustment = {
  priceIndex: new Map([
    ["2023Q1", 100],
    ["2025Q1", 110],
  ]),
  regionFactor: new Map([
    ["BY", 1.1],
    ["BE", 1.0],
  ]),
  targetQuarter: "2025Q1",
  targetRegion: "BE",
};

const pt = (cents: number, companyId: number, over: Partial<PricePoint> = {}): PricePoint => ({
  unitPriceCents: cents,
  companyId,
  quarter: "2025Q1",
  region: "BE",
  weight: 1,
  ...over,
});

describe("adjustment", () => {
  it("brings an old price in an expensive region to today in the target region", () => {
    // 100 € in Bavaria 2023 -> x 1.10 (index) / 1.10 (Bavaria) = 100 € in Berlin 2025
    expect(adjust(pt(10_000, 1, { quarter: "2023Q1", region: "BY" }), adj)).toBeCloseTo(10_000);
  });
  it("cannot adjust a quarter without an index value", () => {
    expect(adjust(pt(10_000, 1, { quarter: "2019Q1" }), adj)).toBeNull();
  });
  it("knows quarters", () => {
    expect(quarterOf(new Date("2025-11-30T12:00:00Z"))).toBe("2025Q4");
  });
});

describe("weightedQuantile", () => {
  it("equals the ordinary median for equal weights", () => {
    const xs = [1, 2, 3, 4, 5].map((v) => ({ v, w: 1 }));
    expect(weightedQuantile(xs, 0.5)).toBe(3);
  });
  it("leans towards heavy points", () => {
    // Midpoints at 0.45 and 0.95: the median sits a tenth of the way from 10 to 20.
    const xs = [
      { v: 10, w: 9 },
      { v: 20, w: 1 },
    ];
    expect(weightedQuantile(xs, 0.5)).toBeCloseTo(11);
    expect(weightedQuantile(xs, 0.3)).toBe(10);
  });
});

describe("disclosure control", () => {
  it("publishes a range when enough companies contribute evenly", () => {
    const pts = [1, 2, 3, 4, 5, 6].flatMap((c) => [pt(9_000 + c * 100, c), pt(9_050 + c * 100, c)]);
    const b = benchmark(pts, adj);
    expect(b.status).toBe("ok");
    if (b.status !== "ok") return;
    expect(b.companies).toBe(6);
    expect(b.p10).toBeLessThan(b.p50);
    expect(b.p50).toBeLessThan(b.p90);
    expect(b.p50 % 10).toBe(0); // rounded: never a bidder's exact cent value
  });

  it("suppresses a range that four companies could be traced back to", () => {
    const pts = [1, 2, 3, 4].flatMap((c) => Array.from({ length: 10 }, () => pt(10_000 + c, c)));
    expect(benchmark(pts, adj)).toMatchObject({
      status: "suppressed",
      reason: "too_few_companies",
      companies: 4,
    });
  });

  it("suppresses a range one company dominates, even with many companies", () => {
    const pts = [
      pt(10_000, 1, { weight: 1 }),
      ...[2, 3, 4, 5, 6].map((c) => pt(10_000, c, { weight: 0.05 })),
    ];
    expect(benchmark(pts, adj)).toMatchObject({ status: "suppressed", reason: "dominated" });
  });

  it("does not let one prolific company set the market", () => {
    // Company 1 has 100 prices at 200 €, five others one price each around 100 €.
    const pts = [
      ...Array.from({ length: 100 }, () => pt(20_000, 1)),
      ...[2, 3, 4, 5, 6, 7].map((c) => pt(10_000 + c * 50, c)),
    ];
    const b = benchmark(pts, adj, { minCompanies: 5, maxCompanyShare: 0.9, minEffectivePoints: 1 });
    expect(b.status).toBe("ok");
    if (b.status === "ok") expect(b.p50).toBeLessThan(20_000);
  });

  it("drops decimal slips before summarising", () => {
    const pts = [
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((c) => pt(10_000 + c * 100, c)),
      pt(1_050, 9),
      pt(105_000, 10),
    ];
    const b = benchmark(pts, adj);
    expect(b).toMatchObject({ status: "ok", trimmed: 2 });
    if (b.status === "ok") expect(b.p10).toBeGreaterThan(9_000);
  });

  it("says when there is nothing to compare with", () => {
    expect(benchmark([], adj)).toMatchObject({ status: "suppressed", reason: "no_data" });
  });
});

describe("publishRound", () => {
  it.each([
    [999, 1_000],
    [1_234, 1_230],
    [12_345, 12_300],
    [123_456, 123_000],
  ])("%i -> %i", (a, b) => {
    expect(publishRound(a)).toBe(b);
  });
});
