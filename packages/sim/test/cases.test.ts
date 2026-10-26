import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { FAMILIES, PRICE_INDEX, TRUE_REGION_FACTOR, truePrice } from "../src/catalog.ts";
import { cases, combinations, fill, loadBlind } from "../src/cases.ts";
import { summarise } from "../src/metrics.ts";

describe("evaluation cases", () => {
  it("fills placeholders the way the brief asked for them", () => {
    expect(fill("KS-Mauerwerk d = {thickness} cm", { d: 115 })).toBe("KS-Mauerwerk d = 11,5 cm");
    expect(fill("Sturz l={length} m", { len: 2 })).toBe("Sturz l=2,0 m");
    expect(fill("Wand {concrete}, {thickness} cm", { c: "C30/37", d: 240 })).toBe("Wand C30/37, 24 cm");
    expect(() => fill("Estrich {thickness} cm", {})).toThrow(/placeholder/);
  });

  it("has four blind wordings for every kind of work, each using exactly its attributes", () => {
    const blind = loadBlind();
    expect(Object.keys(blind).sort()).toEqual(FAMILIES.map((f) => f.id).sort());
    for (const f of FAMILIES) {
      expect(blind[f.id]).toHaveLength(4);
      for (const a of combinations(f)) for (const t of blind[f.id]!) expect(() => fill(t, a)).not.toThrow();
    }
  });

  it("covers every attribute combination in every evaluation region", () => {
    const n = FAMILIES.reduce((s, f) => s + combinations(f).length, 0);
    expect(cases("dev")).toHaveLength(n * 4);
    expect(cases("blind")).toHaveLength(n * 4 * 4);
    expect(cases("dev").every((c) => c.truthCents > 0)).toBe(true);
  });

  it("prices the truth with the region and the index", () => {
    const f = FAMILIES.find((x) => x.id === "rebar")!;
    expect(truePrice(f, {}, "BY", "2021Q1") / truePrice(f, {}, "NW", "2021Q1")).toBeCloseTo(
      TRUE_REGION_FACTOR.BY,
      6,
    );
    expect(truePrice(f, {}, "NW", "2026Q4") / truePrice(f, {}, "NW", "2021Q1")).toBeCloseTo(
      PRICE_INDEX["2026Q4"]! / PRICE_INDEX["2021Q1"]!,
      6,
    );
  });
});

describe("metrics", () => {
  const row = (
    p50: number | undefined,
    truth = 100,
    used = [{ weight: 1, sameFamily: true, sameAttrs: true }],
  ) => ({
    family: "x",
    text: "t",
    region: "BE",
    truthCents: truth,
    status: p50 === undefined ? "suppressed" : "ok",
    reason: p50 === undefined ? "too_few_companies" : undefined,
    p10: p50 === undefined ? undefined : p50 * 0.8,
    p50,
    p90: p50 === undefined ? undefined : p50 * 1.2,
    companies: 7,
    used,
  });

  it("counts coverage, error, band and precision", () => {
    const s = summarise([
      row(100),
      row(115),
      row(50, 100, [
        { weight: 3, sameFamily: false, sameAttrs: false },
        { weight: 1, sameFamily: true, sameAttrs: false },
      ]),
      row(undefined),
    ]);
    expect(s.coverage).toBe(0.75);
    expect(s.suppressed).toEqual({ too_few_companies: 1 });
    expect(s.within10).toBeCloseTo(1 / 3);
    expect(s.within20).toBeCloseTo(2 / 3);
    expect(s.truthInBand).toBeCloseTo(2 / 3);
    expect(s.familyPrecision).toBeCloseTo(3 / 6);
    expect(s.exactPrecision).toBeCloseTo(2 / 6);
    expect(s.minCompanies).toBe(7);
  });
});

describe("truth isolation", () => {
  // The platform must not know the answers: nothing outside the simulation reads sim_truth,
  // imports the simulation, or reads the blind wordings.
  const root = new URL("../../../", import.meta.url).pathname;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      if (n === "node_modules" || n === "dist") return [];
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|sql)$/.test(n) ? [p] : [];
    });
  const platform = ["apps/api/src", "apps/api/migrations", "apps/web/src", "packages/domain/src"].flatMap(
    (d) => files(join(root, d)),
  );

  it("finds the platform's sources", () => {
    expect(platform.length).toBeGreaterThan(40);
  });

  it.each(["sim_truth", "@tpw/sim", "packages/sim", "phrasings.json", "TRUE_REGION_FACTOR"])(
    "no platform file mentions %s",
    (needle) => {
      expect(platform.filter((f) => readFileSync(f, "utf8").includes(needle))).toEqual([]);
    },
  );
});
