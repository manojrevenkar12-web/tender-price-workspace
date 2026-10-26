/**
 * Generates the price history: years of past tenders on the platform, each priced by several
 * subcontractors, written straight into Postgres with COPY.
 *
 * What the platform gets is what a real platform would have: position texts as estimators wrote
 * them, units, unit prices, quarter, region and a pseudonymous company number. What it does not
 * get is the truth (which family and attributes a text was, what the market price was); that
 * goes to the separate `sim_truth` schema, which only the evaluation reads.
 */
import { normalise, parseUnit, priceConversion, UNITS } from "@tpw/domain";
import type pg from "pg";
import { from as copyFrom } from "pg-copy-streams";

import {
  FAMILIES,
  type Family,
  pick,
  quarters,
  type Region,
  type Rng,
  type Trade,
  truePrice,
} from "./catalog.ts";
import { intBetween, lognormal, mulberry32, sample } from "./rng.ts";

export interface HistoryOptions {
  seed: number;
  tenders: number;
  companies: number;
  /** Last quarter with history (the platform's "now" is the quarter after). */
  until: string;
  anomalyRate: number;
}

export const DEFAULT_HISTORY: HistoryOptions = {
  seed: 7,
  tenders: 16_000,
  companies: 2_400,
  until: "2026Q3",
  anomalyRate: 0.015,
};

export interface Company {
  id: number;
  trade: Trade;
  region: Region;
  level: number;
}

const REGION_WEIGHT: Record<Region, number> = {
  NW: 18,
  BY: 16,
  BW: 13,
  NI: 10,
  HE: 8,
  SN: 5,
  RP: 5,
  BE: 4.5,
  SH: 3.5,
  BB: 3,
  ST: 2.5,
  TH: 2.5,
  HH: 2.5,
  MV: 2,
  SL: 1,
  HB: 0.8,
};
const TRADE_WEIGHT: Record<Trade, number> = {
  concrete: 18,
  masonry: 12,
  drywall: 12,
  screed_plaster: 10,
  tiling: 10,
  painting: 12,
  electrical: 12,
  plumbing: 10,
  earthworks: 8,
};

function weighted<T extends string>(r: Rng, w: Record<T, number>): T {
  const entries = Object.entries(w) as [T, number][];
  const total = entries.reduce((s, [, v]) => s + v, 0);
  let x = r() * total;
  for (const [k, v] of entries) {
    x -= v;
    if (x <= 0) return k;
  }
  return entries.at(-1)![0];
}

export function makeCompanies(r: Rng, n: number): Company[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    trade: weighted(r, TRADE_WEIGHT),
    region: weighted(r, REGION_WEIGHT),
    level: lognormal(r, 0.1),
  }));
}

const CONTEXT = [
  "im Treppenhaus",
  "Haus 2",
  "Bauabschnitt 1",
  "Achse A-C",
  "nach Detail D-12",
  "Fabrikat wählbar",
  "oder gleichwertig",
  "laut Plan 12",
  "Tiefgarage",
  "Wohnungen",
  "Bauteil Nord",
  "Ebene 3",
  "Kita",
  "Seniorenwohnen",
  "Altbau",
  "Neubau",
  "Bestand",
  "Schulzentrum",
  "Riegel B",
  "Werkplanung beachten",
];

/** Estimators add context words and make typos; neither changes what the work costs. */
export function noisy(text: string, r: Rng): string {
  let t = text;
  if (r() < 0.4) t = `${t}, ${pick(r, CONTEXT)}`;
  if (r() < 0.15) t = `${pick(r, CONTEXT)}: ${t}`;
  if (r() < 0.06) {
    const words = t.split(" ");
    const i = Math.floor(r() * words.length);
    const w = words[i]!;
    if (w.length >= 6 && /^[A-Za-zäöüß]+$/.test(w)) {
      const j = 1 + Math.floor(r() * (w.length - 3));
      words[i] = w.slice(0, j) + w[j + 1] + w[j] + w.slice(j + 2);
      t = words.join(" ");
    }
  }
  return t;
}

export function randomAttrs(f: Family, r: Rng): Record<string, string | number> {
  return Object.fromEntries(f.attrs.map((a) => [a.key, pick(r, a.values)]));
}

/** A price as a careless estimator might type it: mostly right, sometimes a factor 10 off. */
export function typed(price: number, r: Rng, anomalyRate: number, unitCode: string): number {
  const x = r();
  if (x < anomalyRate * 0.8) return r() < 0.5 ? price * 10 : price / 10;
  if (x < anomalyRate && (unitCode === "t" || unitCode === "kg"))
    return unitCode === "t" ? price / 1000 : price * 1000;
  return price;
}

async function copy(client: pg.PoolClient | pg.Client, sql: string, rows: Iterable<string>): Promise<void> {
  const stream = client.query(copyFrom(sql));
  const done = new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", reject);
  });
  let buf: string[] = [];
  for (const row of rows) {
    buf.push(row);
    if (buf.length >= 5_000) {
      if (!stream.write(buf.join(""))) await new Promise((r) => stream.once("drain", r));
      buf = [];
    }
  }
  if (buf.length) stream.write(buf.join(""));
  stream.end();
  await done;
}

export interface HistoryStats {
  tenders: number;
  points: number;
  signatures: number;
  companies: number;
  collisions: number;
  seconds: number;
}

/** Loads price history into an empty price schema. Uses the connection as-is (system role). */
export async function loadHistory(
  client: pg.PoolClient | pg.Client,
  opts: HistoryOptions = DEFAULT_HISTORY,
): Promise<HistoryStats> {
  const t0 = Date.now();
  const r = mulberry32(opts.seed);
  const companies = makeCompanies(r, opts.companies);
  const byTrade = new Map<Trade, Company[]>();
  for (const c of companies) byTrade.set(c.trade, [...(byTrade.get(c.trade) ?? []), c]);
  const qs = quarters().filter((q) => q <= opts.until);

  const signatures = new Map<
    string,
    {
      id: number;
      unit: string;
      words: string;
      attrs: string;
      sample: string;
      family: string;
      famAttrs: string;
    }
  >();
  let collisions = 0;
  const points: string[] = [];
  let pointCount = 0;

  const famByTrade = new Map<Trade, Family[]>();
  for (const f of FAMILIES) famByTrade.set(f.trade, [...(famByTrade.get(f.trade) ?? []), f]);

  for (let t = 0; t < opts.tenders; t++) {
    const trade = weighted(r, TRADE_WEIGHT);
    const region = weighted(r, REGION_WEIGHT);
    const quarter = pick(r, qs);
    const projectFactor = lognormal(r, 0.05);
    const fams = famByTrade.get(trade)!;
    const nPos = intBetween(r, 6, 24);
    const positions = Array.from({ length: nPos }, () => {
      const f = pick(r, fams);
      const attrs = randomAttrs(f, r);
      const unitRaw = pick(r, f.units);
      const text = noisy(f.history(attrs, r), r);
      const unit = parseUnit(unitRaw)!;
      const base =
        UNITS[
          {
            length: "m",
            area: "m2",
            volume: "m3",
            count: "pc",
            mass: "kg",
            time: "h",
            liquid: "l",
            lump: "lump",
          }[unit.dimension] as keyof typeof UNITS
        ];
      const n = normalise(text);
      const key = `${base.code}|${n.key}`;
      let sig = signatures.get(key);
      const famAttrs = JSON.stringify(attrs);
      if (!sig) {
        sig = {
          id: signatures.size + 1,
          unit: base.code,
          words: n.words.join(" "),
          attrs: JSON.stringify(n.attributes),
          sample: text,
          family: f.id,
          famAttrs,
        };
        signatures.set(key, sig);
      } else if (sig.family !== f.id || sig.famAttrs !== famAttrs) collisions++;
      return { f, attrs, unit, base, sig };
    });
    const pool = byTrade.get(trade)!;
    const local = pool.filter((c) => c.region === region);
    const nBids = intBetween(r, 3, 8);
    const bidders = new Set<Company>();
    while (bidders.size < Math.min(nBids, pool.length))
      bidders.add(r() < 0.6 && local.length ? pick(r, local) : pick(r, pool));
    for (const c of bidders) {
      for (const p of positions) {
        const price = truePrice(p.f, p.attrs, region, quarter) * c.level * projectFactor * lognormal(r, 0.07);
        const written = typed(price, r, opts.anomalyRate, p.unit.code);
        const perBase = written * priceConversion(p.unit, p.base)!;
        const cents = Math.max(1, Math.round(perBase * 100));
        points.push(`${p.sig.id}\t${c.id}\t${quarter}\t${region}\t${cents}\n`);
        pointCount++;
      }
    }
  }

  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\t/g, " ").replace(/\n/g, " ");
  await client.query("TRUNCATE price_points, price_signatures, price_companies RESTART IDENTITY CASCADE");
  await copy(
    client,
    "COPY price_companies (id) FROM STDIN",
    companies.map((c) => `${c.id}\n`),
  );
  await client.query("SELECT setval('price_companies_id_seq', $1)", [companies.length]);
  await copy(
    client,
    "COPY price_signatures (id, unit_code, norm_key, norm_words, attributes, sample) FROM STDIN",
    [...signatures.entries()].map(
      ([key, s]) =>
        `${s.id}\t${s.unit}\t${esc(key.split("|")[1]!)}\t${esc(s.words)}\t${esc(s.attrs)}\t${esc(s.sample)}\n`,
    ),
  );
  await client.query("SELECT setval('price_signatures_id_seq', $1)", [signatures.size]);
  await copy(
    client,
    "COPY price_points (signature_id, company_id, quarter, region, unit_price_cents) FROM STDIN",
    points,
  );
  await client.query("ANALYZE price_points; ANALYZE price_signatures");

  // The truth, for the evaluation only.
  await client.query("CREATE SCHEMA IF NOT EXISTS sim_truth");
  await client.query("DROP TABLE IF EXISTS sim_truth.signatures, sim_truth.companies");
  await client.query(
    "CREATE TABLE sim_truth.signatures (signature_id int PRIMARY KEY, family text NOT NULL, attrs jsonb NOT NULL)",
  );
  await client.query(
    "CREATE TABLE sim_truth.companies (company_id int PRIMARY KEY, trade text, region text, level double precision)",
  );
  await copy(
    client,
    "COPY sim_truth.signatures FROM STDIN",
    [...signatures.values()].map((s) => `${s.id}\t${s.family}\t${esc(s.famAttrs)}\n`),
  );
  await copy(
    client,
    "COPY sim_truth.companies FROM STDIN",
    companies.map((c) => `${c.id}\t${c.trade}\t${c.region}\t${c.level}\n`),
  );

  return {
    tenders: opts.tenders,
    points: pointCount,
    signatures: signatures.size,
    companies: companies.length,
    collisions,
    seconds: (Date.now() - t0) / 1000,
  };
}

export { sample };
