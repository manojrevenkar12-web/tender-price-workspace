/**
 * Background work in Postgres: jobs are claimed with FOR UPDATE SKIP LOCKED, so any number of
 * workers can run side by side, and failed jobs are retried with exponential backoff, up to five
 * attempts.
 *
 *  benchmark_version   market ranges for every position of a new BoQ version
 *  contribute_prices   an awarded tender's bids join the price history
 *  refresh_regions     regional price levels re-estimated from the history
 */
import { normalisePosition, parseUnit, priceConversion, quarterOf } from "@tpw/domain";
import type pg from "pg";

import { type Db, withSystem } from "../db.ts";
import { baseUnit, priceMany, refreshRegionFactors, resetVocabulary } from "./pricing.ts";
import { event, positions } from "./tenders.ts";

export interface Job {
  id: number;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

type Handler = (db: Db, payload: Record<string, unknown>) => Promise<void>;

async function benchmarkVersion(db: Db, payload: Record<string, unknown>): Promise<void> {
  const tenderId = String(payload["tenderId"]);
  const version = Number(payload["version"]);
  const t = await db.query<{ org_id: string; region: string; deadline: Date | null }>(
    "SELECT t.org_id, p.region, t.deadline FROM tenders t JOIN projects p ON p.id = t.project_id WHERE t.id = $1",
    [tenderId],
  );
  const tender = t.rows[0];
  if (!tender) return; // deleted meanwhile
  const pos = await positions(db, tenderId, version);
  const quarter = quarterOf(tender.deadline ?? new Date());
  const answers = await priceMany(
    db,
    pos.map((p) => ({
      text: p.shortText,
      longText: p.longText,
      unit: p.unit,
      region: tender.region,
      quarter,
      excludeTender: tenderId,
    })),
  );
  await db.query("DELETE FROM position_benchmarks WHERE tender_id = $1 AND version = $2", [
    tenderId,
    version,
  ]);
  const rows = pos.map((p, i) => ({ p, a: answers[i]! }));
  await db.query(
    `INSERT INTO position_benchmarks (tender_id, version, oz, status, reason, p10, p25, p50, p75, p90, points, companies, signatures)
     SELECT $1, $2, oz, st, rs, a, b, c, d, e, pt, co, sg
       FROM unnest($3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::int[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[])
         AS x(oz, st, rs, a, b, c, d, e, pt, co, sg)`,
    [
      tenderId,
      version,
      rows.map((r) => r.p.oz),
      rows.map((r) => r.a.status),
      rows.map((r) => ("reason" in r.a ? r.a.reason : null)),
      ...(["p10", "p25", "p50", "p75", "p90"] as const).map((k) =>
        rows.map((r) => (r.a.status === "ok" ? r.a[k] : null)),
      ),
      rows.map((r) => r.a.points),
      rows.map((r) => r.a.companies),
      rows.map((r) => r.a.signatures),
    ],
  );
  const ok = answers.filter((a) => a.status === "ok").length;
  await event(db, tenderId, tender.org_id, "benchmarks_ready", { version, ok, total: pos.length });
}

async function contributePrices(db: Db, payload: Record<string, unknown>): Promise<void> {
  const tenderId = String(payload["tenderId"]);
  const already = await db.query("SELECT 1 FROM price_points WHERE source_tender = $1 LIMIT 1", [tenderId]);
  if (already.rowCount) return; // idempotent: a retried job must not count prices twice
  const t = await db.query<{ region: string; updated_at: Date }>(
    "SELECT p.region, t.updated_at FROM tenders t JOIN projects p ON p.id = t.project_id WHERE t.id = $1",
    [tenderId],
  );
  if (!t.rows[0]) return;
  const quarter = quarterOf(t.rows[0].updated_at);
  const bids = await db.query<{ id: string; org_id: string; version: number }>(
    "SELECT id, org_id, version FROM bids WHERE tender_id = $1 AND status = 'submitted'",
    [tenderId],
  );
  for (const b of bids.rows) {
    const company = await db.query<{ id: number }>(
      "INSERT INTO price_companies (org_id) VALUES ($1) ON CONFLICT (org_id) DO UPDATE SET org_id = EXCLUDED.org_id RETURNING id",
      [b.org_id],
    );
    const pos = new Map((await positions(db, tenderId, b.version)).map((p) => [p.oz, p]));
    const items = await db.query<{ oz: string; unit_price_cents: number }>(
      "SELECT oz, unit_price_cents FROM bid_items WHERE bid_id = $1",
      [b.id],
    );
    for (const it of items.rows) {
      const p = pos.get(it.oz);
      const unit = p && parseUnit(p.unit);
      if (!p || !unit || unit.dimension === "lump" || it.unit_price_cents <= 0) continue;
      const base = baseUnit(unit);
      const n = normalisePosition(p.shortText, p.longText);
      if (n.words.length === 0) continue;
      const sig = await db.query<{ id: number }>(
        `INSERT INTO price_signatures (unit_code, norm_key, norm_words, attributes, sample) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (unit_code, norm_key) DO UPDATE SET unit_code = EXCLUDED.unit_code RETURNING id`,
        [base.code, n.key, n.words.join(" "), JSON.stringify(n.attributes), p.shortText],
      );
      const perBase = Math.max(1, Math.round(it.unit_price_cents * priceConversion(unit, base)!));
      await db.query(
        "INSERT INTO price_points (signature_id, company_id, quarter, region, unit_price_cents, source_tender) VALUES ($1, $2, $3, $4, $5, $6)",
        [sig.rows[0]!.id, company.rows[0]!.id, quarter, t.rows[0].region, perBase, tenderId],
      );
    }
  }
  resetVocabulary();
}

export const HANDLERS: Record<string, Handler> = {
  benchmark_version: benchmarkVersion,
  contribute_prices: contributePrices,
  refresh_regions: async (db) => {
    await refreshRegionFactors(db);
  },
};

/** Claims and runs one job. Returns false when there was nothing to do. */
export async function runOne(pool: pg.Pool, log: (m: string) => void = () => undefined): Promise<boolean> {
  const job = await withSystem(pool, async (db) => {
    const r = await db.query<Job>(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1
        WHERE id = (SELECT id FROM jobs WHERE status = 'queued' AND run_after <= now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING id, kind, payload, attempts`,
    );
    return r.rows[0];
  });
  if (!job) return false;
  const handler = HANDLERS[job.kind];
  try {
    if (!handler) throw new Error(`no handler for ${job.kind}`);
    await withSystem(pool, (db) => handler(db, job.payload));
    await withSystem(pool, (db) =>
      db.query("UPDATE jobs SET status = 'done', finished_at = now(), last_error = NULL WHERE id = $1", [
        job.id,
      ]),
    );
    log(`job ${job.id} ${job.kind} done`);
  } catch (e) {
    const msg = (e as Error).message;
    const final = job.attempts >= 5;
    await withSystem(pool, (db) =>
      db.query(
        `UPDATE jobs SET status = $2, last_error = $3, run_after = now() + make_interval(secs => power(2, attempts)),
                finished_at = CASE WHEN $2 = 'failed' THEN now() END WHERE id = $1`,
        [job.id, final ? "failed" : "queued", msg],
      ),
    );
    log(`job ${job.id} ${job.kind} ${final ? "failed" : "will retry"}: ${msg}`);
  }
  return true;
}

/** Runs jobs until none are ready (tests and the seed use this instead of the loop). */
export async function drain(pool: pg.Pool, log?: (m: string) => void): Promise<number> {
  let n = 0;
  while (await runOne(pool, log)) n++;
  return n;
}

export function startWorker(pool: pg.Pool, log: (m: string) => void): () => Promise<void> {
  let stopped = false;
  const loop = (async () => {
    let idle = 250;
    while (!stopped) {
      const did = await runOne(pool, log).catch((e) => {
        log(`worker error: ${(e as Error).message}`);
        return false;
      });
      idle = did ? 0 : Math.min(idle * 2 || 250, 2_000);
      if (idle) await new Promise((r) => setTimeout(r, idle));
    }
  })();
  return async () => {
    stopped = true;
    await loop;
  };
}
