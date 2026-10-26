/** Accuracy of benchmark answers against the true market price. */
export interface Answered {
  family: string;
  text: string;
  region: string;
  truthCents: number;
  status: string;
  reason?: string | undefined;
  p10?: number | undefined;
  p50?: number | undefined;
  p90?: number | undefined;
  companies: number;
  /** Signatures used and whether each is the same kind of work (and the same attributes). */
  used: { weight: number; sameFamily: boolean; sameAttrs: boolean }[];
}

export interface Summary {
  cases: number;
  answered: number;
  coverage: number;
  suppressed: Record<string, number>;
  medianError: number;
  p90Error: number;
  within10: number;
  within20: number;
  truthInBand: number;
  familyPrecision: number;
  exactPrecision: number;
  minCompanies: number;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const share = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : NaN);

export const error = (a: Answered) => Math.abs((a.p50 ?? NaN) - a.truthCents) / a.truthCents;

export function summarise(rows: Answered[]): Summary {
  const ok = rows.filter((r) => r.status === "ok");
  const errors = ok.map(error);
  const suppressed: Record<string, number> = {};
  for (const r of rows)
    if (r.status !== "ok") suppressed[r.reason ?? r.status] = (suppressed[r.reason ?? r.status] ?? 0) + 1;
  let w = 0;
  let wf = 0;
  let wx = 0;
  for (const r of ok)
    for (const u of r.used) {
      w += u.weight;
      if (u.sameFamily) wf += u.weight;
      if (u.sameAttrs) wx += u.weight;
    }
  return {
    cases: rows.length,
    answered: ok.length,
    coverage: ok.length / Math.max(1, rows.length),
    suppressed,
    medianError: quantile(errors, 0.5),
    p90Error: quantile(errors, 0.9),
    within10: share(errors.map((e) => e <= 0.1)),
    within20: share(errors.map((e) => e <= 0.2)),
    truthInBand: share(ok.map((r) => r.p10! <= r.truthCents && r.truthCents <= r.p90!)),
    familyPrecision: w ? wf / w : NaN,
    exactPrecision: w ? wx / w : NaN,
    minCompanies: ok.length ? Math.min(...ok.map((r) => r.companies)) : 0,
  };
}

export function byFamily(rows: Answered[]): { family: string; summary: Summary }[] {
  const groups = new Map<string, Answered[]>();
  for (const r of rows) groups.set(r.family, [...(groups.get(r.family) ?? []), r]);
  return [...groups].map(([family, rs]) => ({ family, summary: summarise(rs) }));
}
