import { describe, expect, it } from "vitest";

import {
  cents,
  formatEuro,
  lineTotal,
  parseEuro,
  parseUnit,
  priceConversion,
  sum,
  UNITS,
} from "../src/index.ts";

describe("units", () => {
  it.each([
    ["m²", "m2"],
    ["qm", "m2"],
    ["M2", "m2"],
    ["lfm", "m"],
    ["Stk.", "pc"],
    ["St", "pc"],
    ["Stück", "pc"],
    ["psch", "lump"],
    ["to", "t"],
    ["m³", "m3"],
    ["Std.", "h"],
  ])("reads %s as %s", (raw, code) => {
    expect(parseUnit(raw)?.code).toBe(code);
  });

  it("does not guess unknown units", () => {
    expect(parseUnit("Wochen")).toBeNull();
  });

  it("converts prices only within one dimension", () => {
    expect(priceConversion(UNITS.t, UNITS.kg)).toBeCloseTo(0.001);
    expect(priceConversion(UNITS.m2, UNITS.m3)).toBeNull();
    expect(priceConversion(UNITS.lump, UNITS.lump)).toBe(1);
  });
});

describe("money", () => {
  it.each([
    ["1.234,56", 123456],
    ["1234.56", 123456],
    ["12,5", 1250],
    ["0,05", 5],
    ["7", 700],
    ["1.234.567,89 €", 123456789],
    ["12,345", 1235],
    ["-3,10", -310],
  ])("parses %s", (raw, expected) => {
    expect(parseEuro(raw)).toBe(expected);
  });

  it("rejects text", () => {
    expect(() => parseEuro("zwölf")).toThrow();
  });

  it("rounds each line to the cent, half away from zero", () => {
    // 12.35 € x 3.333 m² = 41.16255 € -> 41.16 €
    expect(lineTotal(cents(1235), 3.333)).toBe(4116);
    // 0.05 € x 0.5 = 0.025 € -> 0.03 €
    expect(lineTotal(cents(5), 0.5)).toBe(3);
    // 1.10 € x 1000.1 avoids binary drift: 1100.11 €
    expect(lineTotal(cents(110), 1000.1)).toBe(110011);
  });

  it("sums rounded lines, not unrounded products", () => {
    const lines = [lineTotal(cents(333), 0.5), lineTotal(cents(333), 0.5)];
    expect(sum(lines)).toBe(334); // 1.665 -> 1.67 twice, not 3.33
  });

  it("formats in German", () => {
    expect(formatEuro(cents(123456))).toBe("1.234,56 €");
  });
});
