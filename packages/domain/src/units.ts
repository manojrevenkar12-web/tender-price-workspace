/**
 * Units of measure as they appear in German bills of quantities, normalised to one code each.
 *
 * Estimators write the same unit many ways ("m²", "qm", "m2"; "Stk", "St.", "Stück"; "lfm" for
 * running metres). Two prices can only be compared when their units are the same unit, not merely
 * the same dimension: 1 t of reinforcement and 1 kg of reinforcement are comparable after a
 * factor of 1,000; 1 m² and 1 m³ never are.
 */

export type UnitCode = "m" | "m2" | "m3" | "pc" | "kg" | "t" | "h" | "l" | "lump";

export type Dimension = "length" | "area" | "volume" | "count" | "mass" | "time" | "liquid" | "lump";

export interface Unit {
  code: UnitCode;
  dimension: Dimension;
  /** Factor to the dimension's base unit (m, m², m³, piece, kg, h, l, lump). */
  toBase: number;
  label: string;
}

export const UNITS: Record<UnitCode, Unit> = {
  m: { code: "m", dimension: "length", toBase: 1, label: "m" },
  m2: { code: "m2", dimension: "area", toBase: 1, label: "m²" },
  m3: { code: "m3", dimension: "volume", toBase: 1, label: "m³" },
  pc: { code: "pc", dimension: "count", toBase: 1, label: "pc" },
  kg: { code: "kg", dimension: "mass", toBase: 1, label: "kg" },
  t: { code: "t", dimension: "mass", toBase: 1000, label: "t" },
  h: { code: "h", dimension: "time", toBase: 1, label: "h" },
  l: { code: "l", dimension: "liquid", toBase: 1, label: "l" },
  lump: { code: "lump", dimension: "lump", toBase: 1, label: "lump sum" },
};

const ALIASES: Record<string, UnitCode> = {
  m: "m",
  lfm: "m",
  lfdm: "m",
  "lfd.m": "m",
  "lfd. m": "m",
  meter: "m",
  mtr: "m",
  m2: "m2",
  "m²": "m2",
  qm: "m2",
  "m^2": "m2",
  m3: "m3",
  "m³": "m3",
  cbm: "m3",
  "m^3": "m3",
  st: "pc",
  "st.": "pc",
  stk: "pc",
  "stk.": "pc",
  stück: "pc",
  stueck: "pc",
  pc: "pc",
  pcs: "pc",
  ea: "pc",
  kg: "kg",
  t: "t",
  to: "t",
  tonne: "t",
  h: "h",
  std: "h",
  "std.": "h",
  stunde: "h",
  l: "l",
  ltr: "l",
  liter: "l",
  psch: "lump",
  "psch.": "lump",
  pauschal: "lump",
  pau: "lump",
  lump: "lump",
  ls: "lump",
};

export function parseUnit(raw: string): Unit | null {
  const key = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const code = ALIASES[key];
  return code ? UNITS[code] : null;
}

/**
 * Factor that converts a price per `from` into a price per `to`, or null when the two cannot be
 * compared. A price of 1,200 €/t is 1.2 €/kg: factor(t → kg) = 1/1000.
 */
export function priceConversion(from: Unit, to: Unit): number | null {
  if (from.dimension !== to.dimension || from.dimension === "lump") return from.code === to.code ? 1 : null;
  return to.toBase / from.toBase;
}

export function isBenchmarkable(unit: Unit): boolean {
  return unit.dimension !== "lump";
}
