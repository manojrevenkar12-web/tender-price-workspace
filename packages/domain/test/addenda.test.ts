import { describe, expect, it } from "vitest";

import { diffVersions, priceStanding, type VersionedPosition, workHash } from "../src/index.ts";

const pos = (oz: string, over: Partial<VersionedPosition> = {}): VersionedPosition => ({
  oz,
  shortText: `Position ${oz}`,
  longText: "",
  unit: "m2",
  quantity: 100,
  kind: "normal",
  ...over,
});

describe("addenda", () => {
  const v1 = [pos("01.0010"), pos("01.0020"), pos("01.0030"), pos("02.0010")];
  const v2 = [
    pos("01.0010"),
    pos("01.0020", { quantity: 140 }),
    pos("01.0030", { shortText: "Position 01.0030, now with insulation" }),
    pos("02.0020"),
  ];

  it("classifies every change", () => {
    expect(diffVersions(v1, v2)).toEqual([
      { oz: "01.0020", type: "quantity", from: 100, to: 140 },
      { oz: "01.0030", type: "work", fields: ["text"] },
      { oz: "02.0010", type: "removed" },
      { oz: "02.0020", type: "added" },
    ]);
  });

  it("says which prices still stand", () => {
    const priced = new Map(v1.map((p) => [p.oz, p]));
    expect(v2.map((p) => priceStanding(p, priced.get(p.oz), true))).toEqual([
      "current",
      "requantified",
      "stale",
      "missing",
    ]);
    expect(priceStanding(v2[0]!, priced.get("01.0010"), false)).toBe("missing");
  });

  it("ignores whitespace and unit case in the work hash", () => {
    expect(workHash(pos("1", { unit: "M2", shortText: " Position 1 " }))).toBe(
      workHash(pos("1", { shortText: "Position 1" })),
    );
  });
});
