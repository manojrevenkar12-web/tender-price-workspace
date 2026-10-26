import { describe, expect, it } from "vitest";

import {
  attributeFit,
  normalise,
  normalisePosition,
  sameWord,
  trigramSimilarity,
  wordScore,
} from "../src/index.ts";

describe("normalise", () => {
  it("puts two estimators' wording of the same wall on one key", () => {
    const a = normalise("Stb.-Wand C30/37, d=24cm, herst.");
    const b = normalise("Stahlbetonwand aus Beton C30/37, Dicke 240 mm, herstellen");
    expect(a.attributes).toEqual({ concrete: "c30/37", thickness_mm: "240" });
    expect(b.attributes).toEqual(a.attributes);
    expect(a.words).toEqual(["stahlbeton", "wand"]);
    expect(b.words).toEqual(["beton", "stahlbeton", "wand"]);
    // Plurals, compounds and synonyms meet: "Montagewand aus Gipsplatten" is a drywall partition.
    expect(normalise("Montagewand aus Gipsplatten").words).toEqual(["gipskarton", "trockenbau", "wand"]);
    expect(normalise("Bodenfliesen").words).toEqual(normalise("Boden-Fliese").words);
  });

  it("keeps the numbers that change the price apart", () => {
    const thin = normalise("KS-Mauerwerk d=17,5 cm");
    const thick = normalise("KS Mauerwerk, d = 24 cm");
    expect(thin.attributes["thickness_mm"]).toBe("175");
    expect(thick.attributes["thickness_mm"]).toBe("240");
    expect(attributeFit(thin.attributes, thick.attributes)).toBe(0);
    expect(thin.words).toEqual(thick.words);
  });

  it.each([
    ["Bodenfliesen 30x60 cm, R10, verlegen", { format_cm: "30x60", slip: "r10" }],
    ["Bodenfliesen 60 x 30, R 10", { format_cm: "30x60", slip: "r10" }],
    ["Kabel NYM-J 3x1,5 mm² verlegen", { section: "3x1.5" }],
    ["KG-Rohr DN 150 liefern und verlegen", { dn: "150" }],
    ["Trockenbauwand W112, d=12,5 cm", { system: "w112", thickness_mm: "125" }],
    ["Bodenaushub Bodenklasse 3-5, laden und abfahren", { soil: "3-5" }],
    ["Zementestrich 5 cm dick", { thickness_mm: "50" }],
    ["KS-Flachsturz Länge 1,25 m", { length_cm: "125" }],
    ["KS-Flachsturz 2 m einbauen", { length_cm: "200" }],
  ])("extracts attributes from %s", (text, attrs) => {
    expect(normalise(text).attributes).toEqual(attrs);
  });

  it("drops filler that does not change the price", () => {
    expect(
      normalise("Dispersionsfarbe liefern und fachgerecht einbauen inkl. aller Nebenarbeiten").words,
    ).toEqual(["dispersion", "farb"]);
  });

  it("gives equal keys to reordered text", () => {
    expect(normalise("Innenputz Kalkgips einlagig").key).toBe(normalise("einlagig Kalkgips Innenputz").key);
  });
});

describe("attributeFit", () => {
  it("prefers candidates as specific as the query", () => {
    expect(attributeFit({ thickness_mm: "240" }, { thickness_mm: "240" })).toBe(1);
    expect(attributeFit({ thickness_mm: "240" }, {})).toBe(0.5);
    expect(attributeFit({}, { thickness_mm: "240" })).toBe(0.7);
  });
});

describe("trigramSimilarity", () => {
  it("is 1 for equal text and lower for different work", () => {
    expect(trigramSimilarity("stahlbeton wand", "stahlbeton wand")).toBe(1);
    expect(trigramSimilarity("stahlbeton wand", "stahlbeton decke")).toBeLessThan(0.7);
    expect(trigramSimilarity("stahlbeton wand", "dispersion farbe")).toBeLessThan(0.1);
  });
});

describe("wordScore", () => {
  const idf = (w: string) =>
    ({ wand: 1, stahlbeton: 2, schalung: 2, festigkeitsklass: 1.5, beton: 1 })[w] ?? 3;
  it("forgives a query that says more than the candidate", () => {
    expect(
      wordScore(["festigkeitsklass", "schalung", "stahlbeton", "wand"], ["stahlbeton", "wand"], idf),
    ).toBeGreaterThan(0.7);
  });
  it("survives a typo", () => {
    expect(wordScore(["bewehrung", "betonstahl"], ["bewerhung", "betonstahl"], idf)).toBeGreaterThan(0.9);
  });
  it("scores unrelated work low", () => {
    expect(wordScore(["dispersion", "farb"], ["stahlbeton", "wand"], idf)).toBe(0);
  });
});

describe("normalisePosition", () => {
  it("takes words from the short text and fills attributes from the long text", () => {
    const n = normalisePosition(
      "Stahlbetonwand C30/37",
      "Wand d = 24 cm. Ausführung nach DIN und Herstellervorgaben.",
    );
    expect(n.words).toEqual(["stahlbeton", "wand"]);
    expect(n.attributes).toEqual({ concrete: "c30/37", thickness_mm: "240" });
  });
  it("lets the short text win when both state an attribute", () => {
    expect(normalisePosition("Estrich d=5 cm", "Estrich d=6 cm").attributes).toEqual({ thickness_mm: "50" });
  });
});

describe("word forms", () => {
  it("meets participles and infinitives", () => {
    expect(normalise("Rohr verlegt").words).toEqual(normalise("Rohr verlegen").words);
    expect(normalise("lagenweise verdichtet").words).toEqual(normalise("lagenweise verdichten").words);
  });

  it("treats a longer form or a compound as the same word", () => {
    expect(sameWord("grundier", "grundierung")).toBe(true);
    expect(sameWord("spuelkast", "unterputzspuelkast")).toBe(true);
    expect(sameWord("wand", "wandflaech")).toBe(false); // too short to be sure
  });
});

describe("estimators' abbreviations and attributes (from the first blind set's failures)", () => {
  const attrs = (t: string) => normalise(t).attributes;
  it("reads soil classes however they are abbreviated", () => {
    for (const t of ["Bodenklasse 3-5", "Bodenkl. 3 bis 5", "BK 3-5", "BKL 3-5"])
      expect(attrs(t)["soil"]).toBe("3-5");
  });
  it("reads compound thickness words and bare centimetres", () => {
    expect(attrs("Stb.-Wand C25/30, Wanddicke 30 cm")["thickness_mm"]).toBe("300");
    expect(attrs("Kalksandsteinwand 11,5 cm")["thickness_mm"]).toBe("115");
    expect(attrs("Wandfliesen 30x60 cm")).toEqual({ format_cm: "30x60" });
  });
  it("reads cable sections with qmm or without a unit", () => {
    expect(attrs("NYM-J 3x1,5 qmm")["section"]).toBe("3x1.5");
    expect(attrs("NYM-J 5x2,5")["section"]).toBe("5x2.5");
  });
  it("expands standard abbreviations and keeps the rest of a compound", () => {
    expect(normalise("Cu-Rohr").words).toContain("kupfer");
    expect(normalise("Abdichtung AIV").words).toContain("verbund");
    expect(normalise("Stabstahlbewehrung").words).toEqual(
      expect.arrayContaining(["betonstahl", "bewehrung"]),
    );
    expect(normalise("Kiestragschicht").words).toContain("tragschich");
  });
});
