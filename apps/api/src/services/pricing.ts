/**
 * Market ranges for positions, from the price history (see domain/benchmark.ts for the rules).
 *
 * Retrieval is two queries however many positions are asked about: candidate signatures for all
 * positions at once (trigram search, one LATERAL subquery per position), then all price points of
 * all candidates through a covering index. Ranking, attribute checks, adjustment and disclosure
 * control happen in TypeScript, where they are unit-tested.
 */
import {
  type Adjustment,
  attributeFit,
  type Benchmark,
  benchmark,
  DEFAULT_RULE,
  isBenchmarkable,
  normalisePosition,
  parseUnit,
  priceConversion,
  type PricePoint,
  publishRound,
  UNITS,
  type Unit,
  type UnitCode,
  wordScore,
} from "@tpw/domain";

import type { Db } from "../db.ts";

export const MATCH = {
  /** Trigram similarity a signature needs to be retrieved as a candidate. */
  minSimilarity: 0.2,
  candidatesPerPosition: 60,
  /** Word score (domain/text.ts wordScore) a candidate needs to be used. */
  minScore: 0.55,
  signaturesUsed: 20,
  /** How far back history is used, in quarters before the target quarter. */
  windowQuarters: 12,
};

const BASE: Record<string, UnitCode> = {
  length: "m",
  area: "m2",
  volume: "m3",
  count: "pc",
  mass: "kg",
  time: "h",
  liquid: "l",
  lump: "lump",
};

export function baseUnit(unit: Unit): Unit {
  return UNITS[BASE[unit.dimension]!]!;
}

export interface PriceQuery {
  /** Short text (Kurztext): what the work is. */
  text: string;
  /** Long text: only its attributes are used (see normalisePosition). */
  longText?: string | undefined;
  unit: string;
  region: string;
  quarter: string;
  /** Prices from this tender's own bids are never used for its own benchmark. */
  excludeTender?: string | undefined;
}

export type PriceAnswer =
  | (Extract<Benchmark, { status: "ok" }> & { signatures: number; matches: MatchSample[] })
  | (Extract<Benchmark, { status: "suppressed" }> & { signatures: number; matches: MatchSample[] })
  | {
      status: "not_comparable";
      reason: "lump_sum" | "unknown_unit";
      points: 0;
      companies: 0;
      signatures: 0;
      matches: [];
    };

export interface MatchSample {
  text: string;
  similarity: number;
  weight: number;
}

export function quarterBefore(q: string, n: number): string {
  const [y, qq] = [Number(q.slice(0, 4)), Number(q.slice(5))];
  const idx = y * 4 + (qq - 1) - n;
  return `${Math.floor(idx / 4)}Q${(idx % 4) + 1}`;
}

export async function loadAdjustment(db: Db, region: string, quarter: string): Promise<Adjustment> {
  const idx = await db.query<{ quarter: string; value: number }>("SELECT quarter, value FROM price_index");
  const reg = await db.query<{ region: string; factor: number }>("SELECT region, factor FROM region_factors");
  const priceIndex = new Map(idx.rows.map((r) => [r.quarter, Number(r.value)]));
  // A target quarter past the last published index value uses the latest value.
  let target = quarter;
  if (!priceIndex.has(target)) target = [...priceIndex.keys()].sort().at(-1) ?? quarter;
  return {
    priceIndex,
    regionFactor: new Map(reg.rows.map((r) => [r.region, Number(r.factor)])),
    targetQuarter: target,
    targetRegion: region,
  };
}

interface Candidate {
  idx: number;
  id: number;
  attributes: Record<string, string>;
  sample: string;
  norm_words: string;
  sim: number;
}

function describe(words: string, attributes: Record<string, string>): string {
  const attrs = Object.entries(attributes).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`);
  return attrs.length ? `${words} (${attrs.join(", ")})` : words;
}

/** Inverse document frequency of words over the price history, cached for ten minutes. */
let vocabulary: { at: number; df: Map<string, number>; n: number } | null = null;

export function resetVocabulary(): void {
  vocabulary = null;
}

async function idf(db: Db): Promise<(w: string) => number> {
  if (!vocabulary || Date.now() - vocabulary.at > 600_000) {
    const r = await db.query<{ word: string; df: number }>(
      "SELECT word, count(*)::int AS df FROM price_signatures, unnest(string_to_array(norm_words, ' ')) AS word GROUP BY word",
    );
    const n = (await db.query<{ n: number }>("SELECT count(*)::int AS n FROM price_signatures")).rows[0]!.n;
    vocabulary = { at: Date.now(), df: new Map(r.rows.map((x) => [x.word, x.df])), n };
  }
  const v = vocabulary;
  return (w) => Math.log(1 + v.n / (v.df.get(w) ?? 1));
}

/** Benchmarks for many positions with two round trips to the database. */
export async function priceMany(db: Db, queries: readonly PriceQuery[]): Promise<PriceAnswer[]> {
  const prepared = queries.map((q) => {
    const unit = parseUnit(q.unit);
    const n = normalisePosition(q.text, q.longText ?? "");
    return { q, unit, n, base: unit ? baseUnit(unit) : null };
  });
  const answers: (PriceAnswer | null)[] = prepared.map(({ unit }) => {
    if (!unit)
      return {
        status: "not_comparable",
        reason: "unknown_unit",
        points: 0,
        companies: 0,
        signatures: 0,
        matches: [],
      };
    if (!isBenchmarkable(unit))
      return {
        status: "not_comparable",
        reason: "lump_sum",
        points: 0,
        companies: 0,
        signatures: 0,
        matches: [],
      };
    return null;
  });
  const todo = prepared
    .map((p, i) => ({ ...p, i }))
    .filter((p) => answers[p.i] === null && p.n.words.length > 0);
  for (const p of prepared.map((x, i) => ({ ...x, i }))) {
    if (answers[p.i] === null && p.n.words.length === 0)
      answers[p.i] = {
        status: "suppressed",
        reason: "no_data",
        points: 0,
        companies: 0,
        signatures: 0,
        matches: [],
      };
  }
  if (todo.length === 0) return answers as PriceAnswer[];

  await db.query("SELECT set_config('pg_trgm.similarity_threshold', $1, true)", [
    String(MATCH.minSimilarity),
  ]);
  const cand = await db.query<Candidate>(
    `SELECT q.idx::int AS idx, s.id, s.attributes, s.sample, s.norm_words, s.sim
       FROM unnest($1::text[], $2::text[]) WITH ORDINALITY AS q(words, unit, idx)
       CROSS JOIN LATERAL (
         SELECT id, attributes, sample, norm_words, similarity(norm_words, q.words) AS sim
           FROM price_signatures
          WHERE unit_code = q.unit AND norm_words % q.words
          ORDER BY similarity(norm_words, q.words) DESC
          LIMIT $3
       ) s`,
    [todo.map((t) => t.n.words.join(" ")), todo.map((t) => t.base!.code), MATCH.candidatesPerPosition],
  );
  const byQuery = new Map<number, Candidate[]>();
  for (const c of cand.rows) byQuery.set(c.idx - 1, [...(byQuery.get(c.idx - 1) ?? []), c]);

  // Rank each position's candidates: word score squared times attribute fit.
  const weightOf = await idf(db);
  const chosen = new Map<number, { id: number; weight: number; sample: string; sim: number }[]>();
  const allIds = new Set<number>();
  todo.forEach((t, k) => {
    const ranked = (byQuery.get(k) ?? [])
      .map((c) => {
        const score = wordScore(t.n.words, c.norm_words.split(" "), weightOf);
        return {
          id: c.id,
          // What the match is, normalised: other customers' raw position texts are never shown.
          sample: describe(c.norm_words, c.attributes),
          sim: score,
          weight: score >= MATCH.minScore ? score * score * attributeFit(t.n.attributes, c.attributes) : 0,
        };
      })
      .filter((c) => c.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MATCH.signaturesUsed);
    chosen.set(k, ranked);
    for (const c of ranked) allIds.add(c.id);
  });

  // One read of all price points for all chosen signatures, inside the widest window asked for.
  const quartersAsked = todo.map((t) => t.q.quarter).sort();
  const from = quarterBefore(quartersAsked[0]!, MATCH.windowQuarters);
  const pts = allIds.size
    ? await db.query<{
        signature_id: number;
        company_id: number;
        quarter: string;
        region: string;
        unit_price_cents: number;
        source_tender: string | null;
      }>(
        `SELECT signature_id, company_id, quarter, region, unit_price_cents, source_tender
           FROM price_points WHERE signature_id = ANY($1::int[]) AND quarter >= $2`,
        [[...allIds], from],
      )
    : { rows: [] };
  const bySig = new Map<number, typeof pts.rows>();
  for (const p of pts.rows) bySig.set(p.signature_id, [...(bySig.get(p.signature_id) ?? []), p]);

  const adjCache = new Map<string, Adjustment>();
  for (const [k, t] of todo.entries()) {
    const key = `${t.q.region}|${t.q.quarter}`;
    if (!adjCache.has(key)) adjCache.set(key, await loadAdjustment(db, t.q.region, t.q.quarter));
    const adj = adjCache.get(key)!;
    const lo = quarterBefore(t.q.quarter, MATCH.windowQuarters);
    const sigs = chosen.get(k)!;
    const points: PricePoint[] = [];
    for (const s of sigs) {
      for (const p of bySig.get(s.id) ?? []) {
        if (p.quarter < lo || p.quarter > t.q.quarter) continue;
        if (t.q.excludeTender && p.source_tender === t.q.excludeTender) continue;
        points.push({
          unitPriceCents: p.unit_price_cents,
          companyId: p.company_id,
          quarter: p.quarter,
          region: p.region,
          weight: s.weight,
        });
      }
    }
    const b = benchmark(points, adj, DEFAULT_RULE);
    const matches = sigs.slice(0, 5).map((s) => ({
      text: s.sample,
      similarity: Math.round(s.sim * 100) / 100,
      weight: Math.round(s.weight * 100) / 100,
    }));
    if (b.status === "ok") {
      // Back from the base unit (per kg) to the unit the position is written in (per t).
      const f = priceConversion(t.base!, t.unit!)!;
      const conv = (v: number) => publishRound(v * f);
      answers[t.i] = {
        ...b,
        p10: conv(b.p10),
        p25: conv(b.p25),
        p50: conv(b.p50),
        p75: conv(b.p75),
        p90: conv(b.p90),
        signatures: sigs.length,
        matches,
      };
    } else answers[t.i] = { ...b, signatures: sigs.length, matches };
  }
  return answers as PriceAnswer[];
}

export async function priceOne(db: Db, q: PriceQuery): Promise<PriceAnswer> {
  return (await priceMany(db, [q]))[0]!;
}

/**
 * Regional price levels, estimated from the history itself: per signature, each region's median
 * index-adjusted price against the national median, then the median of those ratios.
 */
export async function refreshRegionFactors(db: Db): Promise<number> {
  const r = await db.query(
    `WITH adj AS (
       SELECT p.signature_id, p.region, p.unit_price_cents / i.value AS v
         FROM price_points p JOIN price_index i USING (quarter)
     ), nat AS (
       SELECT signature_id, percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS m FROM adj GROUP BY 1 HAVING count(*) >= 40
     ), reg AS (
       SELECT a.signature_id, a.region, percentile_cont(0.5) WITHIN GROUP (ORDER BY a.v) / n.m AS ratio
         FROM adj a JOIN nat n USING (signature_id) GROUP BY a.signature_id, a.region, n.m HAVING count(*) >= 8
     )
     INSERT INTO region_factors (region, factor, signatures, computed_at)
     SELECT region, percentile_cont(0.5) WITHIN GROUP (ORDER BY ratio), count(*), now() FROM reg GROUP BY region
     ON CONFLICT (region) DO UPDATE SET factor = EXCLUDED.factor, signatures = EXCLUDED.signatures, computed_at = now()`,
  );
  return r.rowCount ?? 0;
}

/** Loads the construction price index (quarter,value CSV) shipped in data/price_index.csv. */
export async function loadPriceIndex(db: Db, csv: string): Promise<number> {
  const rows = csv
    .trim()
    .split("\n")
    .slice(1)
    .map((l) => l.split(","))
    .filter((r) => /^\d{4}Q[1-4]$/.test(r[0] ?? ""));
  for (const [q, v] of rows) {
    await db.query(
      "INSERT INTO price_index (quarter, value) VALUES ($1, $2) ON CONFLICT (quarter) DO UPDATE SET value = EXCLUDED.value",
      [q, Number(v)],
    );
  }
  return rows.length;
}
