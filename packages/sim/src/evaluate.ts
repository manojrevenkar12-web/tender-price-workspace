/**
 * pnpm --filter @tpw/sim evaluate
 *
 * How good are the market ranges, and how fast is the platform, on the seeded database:
 *   - accuracy of the median against the true market price, coverage, and how often the true
 *     price lies inside the published p10-p90 band, for the dev wordings and the blind wordings;
 *   - match precision: the share of the weight on historical signatures of the same kind of
 *     work (and the same attributes), from sim_truth, which only this file reads;
 *   - disclosure control: no published range rests on fewer than five companies;
 *   - latency of pricing a 2,000-position BoQ and of the comparison endpoint at 2,000 x 25.
 *
 * Writes reports/evaluation.json and reports/EVALUATION.md. The first blind run also writes
 * reports/blind/FIRST_RUN.json, which is never rewritten.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

import { buildApp, createPool, loadConfig, pricing, withSystem } from "@tpw/api";

import { type Case, cases, EVAL_QUARTER, EVAL_REGIONS, type WordingSet } from "./cases.ts";
import { type Answered, byFamily, error, type Summary, summarise } from "./metrics.ts";

const ROOT = new URL("../../../reports/", import.meta.url);
const config = loadConfig();
const admin = createPool(config.migrationDatabaseUrl, 2);
const app = createPool(config.databaseUrl, 6);

const truth = new Map(
  (
    await admin.query<{ signature_id: number; family: string; attrs: Record<string, string | number> }>(
      "SELECT signature_id, family, attrs FROM sim_truth.signatures",
    )
  ).rows.map((r) => [r.signature_id, r]),
);
const sameAttrs = (a: Record<string, string | number>, b: Record<string, string | number>) =>
  Object.keys(a).every((k) => String(a[k]) === String(b[k]));

async function run(list: Case[]): Promise<{ rows: Answered[]; ms: number }> {
  const used = new Map<number, { id: number; weight: number }[]>();
  const t0 = performance.now();
  const answers: pricing.PriceAnswer[] = [];
  for (let i = 0; i < list.length; i += 500) {
    const chunk = list.slice(i, i + 500);
    const a = await withSystem(app, (db) =>
      pricing.priceMany(
        db,
        chunk.map((c) => ({ text: c.text, unit: c.unit, region: c.region, quarter: c.quarter })),
        (q, sigs) => used.set(i + q, [...sigs]),
      ),
    );
    answers.push(...a);
  }
  const ms = performance.now() - t0;
  const rows = list.map((c, i): Answered => {
    const a = answers[i]!;
    return {
      family: c.family,
      text: c.text,
      region: c.region,
      truthCents: c.truthCents,
      status: a.status,
      reason: "reason" in a ? a.reason : undefined,
      p10: a.status === "ok" ? a.p10 : undefined,
      p50: a.status === "ok" ? a.p50 : undefined,
      p90: a.status === "ok" ? a.p90 : undefined,
      companies: a.companies,
      used: (used.get(i) ?? []).map((u) => {
        const t = truth.get(u.id);
        return {
          weight: u.weight,
          sameFamily: t?.family === c.family,
          sameAttrs: t?.family === c.family && sameAttrs(c.attrs, t.attrs),
        };
      }),
    };
  });
  return { rows, ms };
}

const results = {} as Record<WordingSet, { summary: Summary; rows: Answered[]; ms: number }>;
// EVAL_SETS=dev runs only the dev wordings (for checking the evaluation itself; nothing is written).
const sets = (process.env["EVAL_SETS"] ?? "dev,regression-v1,blind").split(",") as WordingSet[];
for (const set of sets) {
  const r = await run(cases(set));
  results[set] = { ...r, summary: summarise(r.rows) };
  console.log(
    `${set}: ${r.rows.length} cases, coverage ${pct(results[set].summary.coverage)}, median error ${pct(results[set].summary.medianError)}, ${(r.ms / r.rows.length).toFixed(1)} ms per position`,
  );
}

if (!sets.includes("blind")) {
  for (const set of sets) console.log(set, JSON.stringify(results[set].summary));
  await admin.end();
  await app.end();
  process.exit(0);
}

// Latency: the 2,000-position tender priced in one call, and single positions.
const big = await admin.query<{
  id: string;
  region: string;
  short_text: string;
  long_text: string;
  unit: string;
}>(
  `SELECT t.id, p.region, b.short_text, b.long_text, b.unit FROM tenders t
     JOIN projects p ON p.id = t.project_id
     JOIN boq_positions b ON b.tender_id = t.id AND b.version = t.current_version
    WHERE t.title LIKE 'Klinikum Nord%' ORDER BY b.ordinal`,
);
let bulk: { positions: number; ms: number } | null = null;
const single: number[] = [];
if (big.rows.length) {
  const qs = big.rows.map((b) => ({
    text: b.short_text,
    longText: b.long_text,
    unit: b.unit,
    region: b.region,
    quarter: EVAL_QUARTER,
  }));
  await withSystem(app, (db) => pricing.priceMany(db, qs.slice(0, 50))); // warm the vocabulary cache
  // As the background job does it: four connections at once.
  const t0 = performance.now();
  await pricing.pricePool(app, qs);
  bulk = { positions: qs.length, ms: performance.now() - t0 };
  for (const q of qs.filter((_, i) => i % 40 === 0)) {
    const s = performance.now();
    await withSystem(app, (db) => pricing.priceOne(db, q));
    single.push(performance.now() - s);
  }
}

// The comparison endpoint for the 2,000 x 25 tender, as the buyer's browser asks for it.
let comparison: {
  p50: number;
  p95: number;
  rawBytes: number;
  gzipBytes: number;
  rows: number;
  bids: number;
} | null = null;
if (big.rows.length) {
  const api = await buildApp({
    pool: app,
    config: { tokenSecret: "evaluation", corsOrigin: "x", demoMode: true },
  });
  const buyer = await admin.query<{ email: string }>(
    "SELECT u.email FROM users u JOIN tenders t ON t.org_id = u.org_id WHERE t.id = $1 LIMIT 1",
    [big.rows[0]!.id],
  );
  const token = (
    await api.inject({ method: "POST", url: "/api/session", payload: { email: buyer.rows[0]!.email } })
  ).json().token;
  const times: number[] = [];
  let body = "";
  for (let i = 0; i < 12; i++) {
    const s = performance.now();
    const res = await api.inject({
      url: `/api/tenders/${big.rows[0]!.id}/comparison`,
      headers: { authorization: `Bearer ${token}` },
    });
    if (i >= 2) times.push(performance.now() - s);
    body = res.body;
  }
  const parsed = JSON.parse(body);
  const c = parsed.comparison ?? parsed;
  comparison = {
    p50: q(times, 0.5),
    p95: q(times, 0.95),
    rawBytes: Buffer.byteLength(body),
    gzipBytes: gzipSync(body).length,
    rows: c.rows.length,
    bids: c.bids.length,
  };
  await api.close();
}

const report = {
  generatedAt: new Date().toISOString(),
  quarter: EVAL_QUARTER,
  regions: EVAL_REGIONS,
  history: {
    prices: Number((await admin.query("SELECT count(*) AS n FROM price_points")).rows[0].n),
    signatures: truth.size,
  },
  dev: results.dev.summary,
  regressionV1: results["regression-v1"].summary,
  blind: results.blind.summary,
  blindByFamily: byFamily(results.blind.rows).map((f) => ({ family: f.family, ...f.summary })),
  devByFamily: byFamily(results.dev.rows).map((f) => ({ family: f.family, ...f.summary })),
  worstBlind: worst(results.blind.rows),
  latency: {
    bulk,
    singleP50: q(single, 0.5),
    singleP95: q(single, 0.95),
    perPositionEvalMs:
      (results.dev.ms + results.blind.ms) / (results.dev.rows.length + results.blind.rows.length),
  },
  comparison,
};

mkdirSync(new URL("blind/", ROOT), { recursive: true });
writeFileSync(new URL("evaluation.json", ROOT), JSON.stringify(report, null, 2) + "\n");
const first = new URL("blind/FIRST_RUN.json", ROOT);
if (!existsSync(first)) {
  writeFileSync(
    first,
    JSON.stringify(
      {
        recordedAt: report.generatedAt,
        blind: report.blind,
        blindByFamily: report.blindByFamily,
        worstBlind: report.worstBlind,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("blind: first run recorded in reports/blind/FIRST_RUN.json");
}
const firstRun = JSON.parse(readFileSync(first, "utf8")) as { recordedAt: string; blind: Summary };
writeFileSync(new URL("EVALUATION.md", ROOT), markdown(report, firstRun));
console.log("wrote reports/evaluation.json and reports/EVALUATION.md");
await admin.end();
await app.end();

function q(xs: number[], p: number) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))]! : NaN;
}
function pct(x: number, digits = 1) {
  return Number.isFinite(x) ? `${(x * 100).toFixed(digits)} %` : "n/a";
}
function worst(rows: Answered[]) {
  return rows
    .filter((r) => r.status === "ok")
    .map((r) => ({
      family: r.family,
      region: r.region,
      text: r.text,
      p50: r.p50,
      truth: r.truthCents,
      error: Math.round(error(r) * 1000) / 1000,
    }))
    .sort((a, b) => b.error - a.error)
    .slice(0, 10);
}

function eur(c: number | undefined) {
  return c === undefined
    ? ""
    : `${(c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function markdown(r: typeof report, firstRun: { recordedAt: string; blind: Summary }): string {
  const v1First = JSON.parse(readFileSync(new URL("regression/blind-v1/FIRST_RUN.json", ROOT), "utf8")) as {
    blind: Summary;
  };
  const line = (name: string, s: Summary) =>
    `| ${name} | ${s.cases} | ${pct(s.coverage)} | ${pct(s.medianError)} | ${pct(s.p90Error)} | ${pct(s.within10)} | ${pct(s.within20)} | ${pct(s.truthInBand)} | ${pct(s.familyPrecision)} | ${pct(s.exactPrecision)} | ${s.minCompanies} |`;
  const fam = r.blindByFamily
    .map(
      (f) =>
        `| ${f.family} | ${f.cases} | ${pct(f.coverage, 0)} | ${pct(f.medianError)} | ${pct(f.within20, 0)} | ${pct(f.familyPrecision, 0)} | ${Object.entries(
          f.suppressed,
        )
          .map(([k, v]) => `${k} ${v}`)
          .join(", ")} |`,
    )
    .join("\n");
  return `# Evaluation

Generated by \`pnpm --filter @tpw/sim evaluate\` on the seeded database (${r.history.prices.toLocaleString("en")} historical unit prices, ${r.history.signatures.toLocaleString("en")} distinct position wordings). Do not edit by hand.

Every case asks for the market range of one kind of work, with one combination of its attributes, in one of ${r.regions.join(", ")}, for ${r.quarter} (the quarter after the history ends), and compares the answer with the simulation's true market price. Two wording sets:

- **dev**: the catalog's development wordings, used while the matcher was built.
- **regression v1**: the first blind set. Its failures (soil classes written "BK 3-5", thicknesses as "Wanddicke 30 cm", cable sections in "qmm", abbreviations such as Hlz, ZE, WT, UV, Cu, AIV) were studied and fixed, so it is now a regression set; its first run is kept in \`reports/regression/blind-v1/FIRST_RUN.json\`.
- **blind (v2)**: 4 new wordings per kind of work, written from \`packages/sim/blind/BRIEF.md\` alone by an author who saw neither the history wordings, the matcher, nor the first set, after those fixes. Its first run (${firstRun.recordedAt.slice(0, 10)}) is kept in \`reports/blind/FIRST_RUN.json\` and is never rewritten; the matcher was not changed against it.

| set | cases | coverage | median error | p90 error | within 10 % | within 20 % | truth in p10-p90 | same work (weight) | same work and attributes | min companies |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${line("dev", r.dev)}
${line("blind v2 (now)", r.blind)}
${line("regression v1 (now)", r.regressionV1)}
${line("regression v1, first run (before the fixes)", v1First.blind)}
${line("blind v2, first run", firstRun.blind)}

Coverage is the share of cases that got a published range; the rest were suppressed (dev: ${JSON.stringify(r.dev.suppressed)}, blind: ${JSON.stringify(r.blind.suppressed)}). "Same work" is the share of the matching weight that fell on historical wordings of the same kind of work, from the simulation's truth, which the platform never reads. No published range rests on fewer than five companies (disclosure control).

## Blind set by kind of work

| kind of work | cases | coverage | median error | within 20 % | same work | suppressed |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
${fam}

## Largest blind errors

| kind of work | region | wording | median | truth | error |
| --- | --- | --- | ---: | ---: | ---: |
${r.worstBlind.map((w) => `| ${w.family} | ${w.region} | ${w.text} | ${eur(w.p50)} | ${eur(w.truth)} | ${pct(w.error, 0)} |`).join("\n")}

## Speed

| what | result |
| --- | --- |
| price a ${r.latency.bulk?.positions ?? 0}-position BoQ (background job, 4 connections) | ${r.latency.bulk ? `${(r.latency.bulk.ms / 1000).toFixed(2)} s (${(r.latency.bulk.ms / r.latency.bulk.positions).toFixed(1)} ms per position)` : "n/a"} |
| price one position (p50 / p95) | ${r.latency.singleP50.toFixed(0)} ms / ${r.latency.singleP95.toFixed(0)} ms |
| comparison, ${r.comparison?.rows ?? 0} positions x ${r.comparison?.bids ?? 0} bids (p50 / p95, in process) | ${r.comparison ? `${r.comparison.p50.toFixed(0)} ms / ${r.comparison.p95.toFixed(0)} ms` : "n/a"} |
| comparison payload (raw / gzip) | ${r.comparison ? `${(r.comparison.rawBytes / 1e6).toFixed(1)} MB / ${(r.comparison.gzipBytes / 1e6).toFixed(2)} MB` : "n/a"} |
`;
}
