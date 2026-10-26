import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { cents, GaebError, parseGaeb, writeGaeb } from "../src/index.ts";

const x83 = readFileSync(new URL("./fixtures/rohbau.x83", import.meta.url), "utf8");

describe("GAEB X83", () => {
  const boq = parseGaeb(x83);

  it("reads the breakdown into full ordinal numbers with section labels", () => {
    expect(boq.name).toBe("Rohbau Wohnanlage Lindenhof");
    expect(boq.positions.map((p) => p.oz)).toEqual([
      "01.0010",
      "01.0020",
      "02.0010",
      "02.0020",
      "02.0030",
      "02.0040",
    ]);
    expect(boq.positions[2]!.section).toEqual(["Beton- und Stahlbetonarbeiten"]);
  });

  it("reads texts, quantities and units", () => {
    const wall = boq.positions[2]!;
    expect(wall.shortText).toBe("Stb.-Wand C30/37, d=24cm");
    expect(wall.longText).toBe("Stahlbetonwand C30/37, d=24 cm, Sichtbetonklasse SB2.");
    expect(wall.quantity).toBe(412.5);
    expect(wall.unit).toBe("m²");
    expect(boq.positions[1]!.longText).toBe("Boden der Bodenklasse 3-5 lösen,\nladen und abfahren.");
  });

  it("knows lump sums, optional items and alternatives", () => {
    expect(boq.positions.map((p) => p.kind)).toEqual([
      "lump",
      "normal",
      "normal",
      "normal",
      "optional",
      "alternative",
    ]);
    expect(boq.positions[0]!.unit).toBe("psch");
    expect(boq.positions[5]!.alternativeGroup).toBe("1");
  });

  it("round-trips through an X84 bid with prices and totals", () => {
    const prices = new Map(boq.positions.map((p, i) => [p.oz, cents(1000 * (i + 1) + 99)]));
    const xml = writeGaeb({ ...boq, dp: 84, prices, bidder: "Muster Bau GmbH" });
    expect(xml).toContain("<IT>12783.38</IT>"); // 30.99 € x 412.5 m² = 12,783.375 €
    expect(xml).not.toMatch(/<Item RNoPart="0030">[\s\S]*?<IT>[\s\S]*?<\/Item>\s*<Item RNoPart="0040">/);
    const back = parseGaeb(xml);
    expect(back.dp).toBe(84);
    expect(back.bidder).toBe("Muster Bau GmbH");
    expect([...back.prices!.entries()]).toEqual([...prices.entries()]);
    expect(
      back.positions.map(({ oz, kind, quantity, shortText }) => ({ oz, kind, quantity, shortText })),
    ).toEqual(boq.positions.map(({ oz, kind, quantity, shortText }) => ({ oz, kind, quantity, shortText })));
  });
});

describe("GAEB errors name the place", () => {
  it.each([
    ["<html/>", "no <GAEB> root"],
    ["<GAEB><Award><DP>81</DP></Award></GAEB>", "DP 81"],
    [
      x83.replace(
        '<Item RNoPart="0020">\n                <Qty>850.000',
        '<Item RNoPart="0010">\n                <Qty>850.000',
      ),
      "duplicate OZ 01.0010",
    ],
    [x83.replace("<Qty>38.500</Qty>", "<Qty>viel</Qty>"), 'quantity "viel"'],
    ["<GAEB><Award><DP>83</DP><BoQ><BoQBody/></BoQ></Award></GAEB>", "no items"],
  ])("%#", (xml, message) => {
    expect(() => parseGaeb(xml)).toThrow(GaebError);
    expect(() => parseGaeb(xml)).toThrow(message);
  });
});
