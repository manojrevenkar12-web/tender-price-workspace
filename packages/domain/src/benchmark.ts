/**
 * Market price ranges from historical bid prices, with disclosure control.
 *
 * Every historical price is brought to the tender's date and region (construction price index,
 * regional price level), weighted by how closely its position matches the one being priced,
 * cleaned of decimal slips, and summarised as weighted quantiles.
 *
 * The prices are other companies' bids, which those companies gave in confidence. A range is
 * only shown when it cannot be traced back to one of them: at least `minCompanies` distinct
 * companies must contribute, no single company may carry more than `maxCompanyShare` of the
 * weight (the dominance rule used for official business statistics), and the quantiles are
 * rounded. A company's prices count as at most three independent prices. Otherwise the answer is "suppressed", with the reason.
 */

export interface PricePoint {
  unitPriceCents: number;
  companyId: number;
  /** "2024Q3" */
  quarter: string;
  region: string;
  /** Match quality of the historical position, 0..1. */
  weight: number;
}

export interface DisclosureRule {
  minCompanies: number;
  maxCompanyShare: number;
  minEffectivePoints: number;
}

export const DEFAULT_RULE: DisclosureRule = { minCompanies: 5, maxCompanyShare: 0.4, minEffectivePoints: 6 };

export interface Adjustment {
  priceIndex: ReadonlyMap<string, number>;
  regionFactor: ReadonlyMap<string, number>;
  targetQuarter: string;
  targetRegion: string;
}

export type Benchmark =
  | {
      status: "ok";
      p10: number;
      p25: number;
      p50: number;
      p75: number;
      p90: number;
      points: number;
      companies: number;
      effectivePoints: number;
      trimmed: number;
    }
  | {
      status: "suppressed";
      reason: "no_data" | "too_few_companies" | "dominated" | "too_few_points";
      points: number;
      companies: number;
    };

export function quarterOf(date: Date): string {
  return `${date.getUTCFullYear()}Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

export function adjust(p: PricePoint, a: Adjustment): number | null {
  const from = a.priceIndex.get(p.quarter);
  const to = a.priceIndex.get(a.targetQuarter);
  const rf = a.regionFactor.get(p.region) ?? 1;
  const rt = a.regionFactor.get(a.targetRegion) ?? 1;
  if (from === undefined || to === undefined) return null;
  return (p.unitPriceCents * (to / from) * rt) / rf;
}

/** Weighted quantile with linear interpolation between neighbouring cumulative weights. */
export function weightedQuantile(values: readonly { v: number; w: number }[], q: number): number {
  const xs = [...values].filter((x) => x.w > 0).sort((a, b) => a.v - b.v);
  if (xs.length === 0) return Number.NaN;
  if (xs.length === 1) return xs[0]!.v;
  const total = xs.reduce((s, x) => s + x.w, 0);
  // Midpoint rule: each value sits at the centre of its weight band.
  let cum = 0;
  const pos = xs.map((x) => {
    const mid = (cum + x.w / 2) / total;
    cum += x.w;
    return mid;
  });
  if (q <= pos[0]!) return xs[0]!.v;
  if (q >= pos.at(-1)!) return xs.at(-1)!.v;
  for (let i = 1; i < xs.length; i++) {
    if (q <= pos[i]!) {
      const t = (q - pos[i - 1]!) / (pos[i]! - pos[i - 1]!);
      return xs[i - 1]!.v + t * (xs[i]!.v - xs[i - 1]!.v);
    }
  }
  return xs.at(-1)!.v;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Rounds so that a published quantile does not reproduce any single price to the cent. */
export function publishRound(centsValue: number): number {
  if (centsValue < 1_000) return Math.round(centsValue / 5) * 5; // under 10 €: 5 ct
  if (centsValue < 10_000) return Math.round(centsValue / 10) * 10; // under 100 €: 10 ct
  if (centsValue < 100_000) return Math.round(centsValue / 100) * 100; // under 1,000 €: 1 €
  return Math.round(centsValue / 1_000) * 1_000; // 10 €
}

export function benchmark(
  points: readonly PricePoint[],
  a: Adjustment,
  rule: DisclosureRule = DEFAULT_RULE,
): Benchmark {
  const adjusted = points
    .map((p) => ({ p, v: adjust(p, a) }))
    .filter((x): x is { p: PricePoint; v: number } => x.v !== null && x.v > 0 && x.p.weight > 0);
  if (adjusted.length === 0) return { status: "suppressed", reason: "no_data", points: 0, companies: 0 };

  // Decimal slips and unit mix-ups (a price per t typed as per kg) are far from everything
  // else in log space. The centre and spread are taken over one median per company, so a
  // prolific company cannot make the others look like outliers; the spread is floored at the
  // dispersion honest bids show (0.15 in log terms), so ordinary price differences survive.
  const logs = adjusted.map((x) => Math.log(x.v));
  const byCompany = new Map<number, number[]>();
  adjusted.forEach((x, i) =>
    byCompany.set(x.p.companyId, [...(byCompany.get(x.p.companyId) ?? []), logs[i]!]),
  );
  const companyMedians = [...byCompany.values()].map(median);
  const med = median(companyMedians);
  const mad = Math.max(median(companyMedians.map((l) => Math.abs(l - med))), 0.15);
  const kept = adjusted.filter((_, i) => Math.abs((0.6745 * (logs[i]! - med)) / mad) <= 3.5);

  // A company's prices count as at most three independent prices, however many it has.
  const perCompany = new Map<number, number>();
  for (const x of kept) perCompany.set(x.p.companyId, (perCompany.get(x.p.companyId) ?? 0) + 1);
  const weighted = kept.map((x) => {
    const n = perCompany.get(x.p.companyId)!;
    return { v: x.v, w: (x.p.weight * Math.min(n, 3)) / n, c: x.p.companyId };
  });

  const companies = perCompany.size;
  const totalW = weighted.reduce((s, x) => s + x.w, 0);
  const shareByCompany = new Map<number, number>();
  for (const x of weighted) shareByCompany.set(x.c, (shareByCompany.get(x.c) ?? 0) + x.w / totalW);
  const topShare = Math.max(...shareByCompany.values());
  const sumW2 = weighted.reduce((s, x) => s + x.w * x.w, 0);
  const effectivePoints = (totalW * totalW) / sumW2;

  if (companies < rule.minCompanies)
    return { status: "suppressed", reason: "too_few_companies", points: kept.length, companies };
  if (topShare > rule.maxCompanyShare)
    return { status: "suppressed", reason: "dominated", points: kept.length, companies };
  if (effectivePoints < rule.minEffectivePoints)
    return { status: "suppressed", reason: "too_few_points", points: kept.length, companies };

  const q = (p: number) => publishRound(weightedQuantile(weighted, p));
  return {
    status: "ok",
    p10: q(0.1),
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: q(0.9),
    points: kept.length,
    companies,
    effectivePoints: Math.round(effectivePoints * 10) / 10,
    trimmed: adjusted.length - kept.length,
  };
}
