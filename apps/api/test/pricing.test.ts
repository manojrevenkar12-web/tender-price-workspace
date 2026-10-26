import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withSystem } from "../src/db.ts";
import { drain } from "../src/services/jobs.ts";
import { priceMany, quarterBefore } from "../src/services/pricing.ts";
import { api, bid, type Ctx, openTender, reset, start, stop, world, type World } from "./helpers.ts";

let c: Ctx;
let w: World;
beforeAll(async () => (c = await start()));
afterAll(async () => stop(c));

async function signature(
  unit: string,
  words: string,
  attrs: Record<string, string>,
  sample: string,
): Promise<number> {
  const key = [...words.split(" "), ...Object.entries(attrs).map(([k, v]) => `${k}=${v}`)].join(" ");
  const r = await c.admin.query<{ id: number }>(
    "INSERT INTO price_signatures (unit_code, norm_key, norm_words, attributes, sample) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [unit, key, words, JSON.stringify(attrs), sample],
  );
  return r.rows[0]!.id;
}

async function points(
  sig: number,
  prices: [company: number, cents: number][],
  quarter = "2026Q2",
  region = "BE",
  sourceTender: string | null = null,
) {
  for (const [company] of prices)
    await c.admin.query("INSERT INTO price_companies (id) VALUES ($1) ON CONFLICT DO NOTHING", [company]);
  for (const [company, cents] of prices) {
    await c.admin.query(
      "INSERT INTO price_points (signature_id, company_id, quarter, region, unit_price_cents, source_tender) VALUES ($1, $2, $3, $4, $5, $6)",
      [sig, company, quarter, region, cents, sourceTender],
    );
  }
}

/** Six companies, two prices each, spread evenly around `base` (step apart). */
const six = (base: number, step = 100): [number, number][] =>
  [1, 2, 3, 4, 5, 6].flatMap((co) => [
    [co, Math.round(base + (co - 3.5) * step)] as [number, number],
    [co, Math.round(base + (co - 3) * step)] as [number, number],
  ]);

beforeEach(async () => {
  await reset(c);
  w = await world(c, 3);
  const wall24 = await signature("m2", "stahlbeton wand", { thickness_mm: "240" }, "Stb.-Wand d=24 cm");
  const wall175 = await signature("m2", "stahlbeton wand", { thickness_mm: "175" }, "Stb.-Wand d=17,5 cm");
  const volume = await signature("m3", "stahlbeton wand", {}, "Stahlbetonwand je m³");
  const rebar = await signature("kg", "betonstahl", {}, "Betonstahl B500B");
  await points(wall24, six(10_000));
  await points(wall175, six(7_000));
  await points(volume, six(40_000));
  await points(rebar, six(220, 3));
  await c.admin.query(
    "INSERT INTO region_factors (region, factor, signatures) VALUES ('BE', 1.0, 10), ('BY', 1.2, 10)",
  );
});

describe("price check", () => {
  it("uses only the same work: same attributes, same unit dimension", async () => {
    const r = (
      await api(
        c,
        w.buyer.token,
        "GET",
        "/api/price-check?text=Stahlbetonwand%20d%3D24%20cm&unit=m%C2%B2&region=BE&quarter=2026Q3",
      )
    ).json();
    expect(r).toMatchObject({ status: "ok", companies: 6, signatures: 1 });
    expect(r.p50).toBeGreaterThan(9_900);
    expect(r.p50).toBeLessThan(10_500);
    expect(r.matches[0].text).toBe("Stb.-Wand d=24 cm");
  });

  it("converts the unit the position is written in", async () => {
    const r = (
      await api(
        c,
        w.buyer.token,
        "GET",
        "/api/price-check?text=Bewehrung%20Betonstahl&unit=t&region=BE&quarter=2026Q3",
      )
    ).json();
    expect(r.status).toBe("ok");
    expect(r.p50).toBeGreaterThan(215_000); // ~2.20 €/kg -> ~2,200 €/t
    expect(r.p50).toBeLessThan(235_000);
  });

  it("brings prices to the target region", async () => {
    const r = (
      await api(
        c,
        w.buyer.token,
        "GET",
        "/api/price-check?text=Stahlbetonwand%20d%3D24%20cm&unit=m2&region=BY&quarter=2026Q3",
      )
    ).json();
    expect(r.p50).toBeGreaterThan(11_900); // x 1.2
    expect(r.p50).toBeLessThan(12_600);
  });

  it("brings prices to the target quarter with the price index", async () => {
    await c.admin.query("UPDATE price_index SET value = 110 WHERE quarter >= '2026Q3'");
    const r = (
      await api(
        c,
        w.buyer.token,
        "GET",
        "/api/price-check?text=Stahlbetonwand%20d%3D24%20cm&unit=m2&region=BE&quarter=2026Q3",
      )
    ).json();
    expect(r.p50).toBeGreaterThan(10_900);
    expect(r.p50).toBeLessThan(11_600);
  });

  it("ignores prices older than the window", async () => {
    expect(quarterBefore("2026Q3", 12)).toBe("2023Q3");
    await c.admin.query("UPDATE price_points SET quarter = '2023Q1'");
    const r = (
      await api(
        c,
        w.buyer.token,
        "GET",
        "/api/price-check?text=Stahlbetonwand%20d%3D24%20cm&unit=m2&region=BE&quarter=2026Q3",
      )
    ).json();
    expect(r).toMatchObject({ status: "suppressed", reason: "no_data" });
  });

  it("will not publish what four companies priced", async () => {
    await c.admin.query("DELETE FROM price_points WHERE company_id IN (5, 6)");
    const r = (
      await api(
        c,
        w.buyer.token,
        "GET",
        "/api/price-check?text=Stahlbetonwand%20d%3D24%20cm&unit=m2&region=BE&quarter=2026Q3",
      )
    ).json();
    expect(r).toMatchObject({ status: "suppressed", reason: "too_few_companies", companies: 4 });
    expect(r.p50).toBeUndefined();
  });

  it("says why a lump sum has no market price", async () => {
    const r = (
      await api(c, w.buyer.token, "GET", "/api/price-check?text=Baustelleneinrichtung&unit=psch&region=BE")
    ).json();
    expect(r).toMatchObject({ status: "not_comparable", reason: "lump_sum" });
  });

  it("answers a whole BoQ in two queries", async () => {
    const queries = Array.from({ length: 300 }, (_, i) => ({
      text: i % 2 ? "Stahlbetonwand d=24 cm" : "Betonstahl",
      unit: i % 2 ? "m2" : "t",
      region: "BE",
      quarter: "2026Q3",
    }));
    let statements = 0;
    const answers = await withSystem(c.pool, async (db) => {
      const orig = db.query.bind(db);
      (db as unknown as { query: unknown }).query = (...a: Parameters<typeof orig>) => {
        statements++;
        return orig(...a);
      };
      return priceMany(db, queries);
    });
    expect(answers.every((a) => a.status === "ok")).toBe(true);
    // set_config, candidates, idf (two), points, then per distinct region/quarter: index + regions
    expect(statements).toBeLessThanOrEqual(8);
  });
});

describe("market ranges in the comparison", () => {
  it("are computed by the worker, exclude the tender's own prices and flag a price above the market", async () => {
    const id = await openTender(c, w, [
      { oz: "1", shortText: "Stahlbetonwand d=24 cm", unit: "m2", quantity: 100 },
      { oz: "2", shortText: "Betonstahl B500B", unit: "t", quantity: 5 },
    ]);
    await c.admin.query("UPDATE projects SET region = 'BE'");
    // The tender's own prices would be in the history if it were awarded once already.
    const sig = (await c.admin.query("SELECT id FROM price_signatures WHERE sample = 'Stb.-Wand d=24 cm'"))
      .rows[0].id;
    await points(
      sig,
      [
        [1, 90_000],
        [2, 90_000],
        [3, 90_000],
      ],
      "2026Q2",
      "BE",
      id,
    );
    await bid(c, w.subs[0]!.token, id, { "1": 10_100, "2": 221_000 });
    await bid(c, w.subs[1]!.token, id, { "1": 9_900, "2": 219_000 });
    await bid(c, w.subs[2]!.token, id, { "1": 13_500, "2": 22_000 });
    await drain(c.pool);
    const cmp = (await api(c, w.buyer.token, "GET", `/api/tenders/${id}/comparison`)).json();
    expect(cmp.benchmarks).toEqual({ ready: 2, total: 2 });
    const wall = cmp.rows.find((r: { oz: string }) => r.oz === "1");
    expect(wall.market.p50).toBeLessThan(10_600); // the tender's own 900 € prices were not used
    const third = cmp.bids.find((b: { bidder: string }) => b.bidder === "Sub 3 GmbH").bidId;
    expect(wall.cells[third].flags).toContain("above_market");
    const rebar = cmp.rows.find((r: { oz: string }) => r.oz === "2");
    expect(rebar.cells[third].flags).toContain("decimal_slip");
  });
});
