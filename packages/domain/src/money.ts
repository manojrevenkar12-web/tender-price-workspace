/**
 * Money is integer euro cents everywhere; floating point only exists inside statistics.
 *
 * A position's total is its unit price times its quantity, rounded half away from zero to the
 * cent, the way GAEB and German estimating software compute "Gesamtbetrag". A bid's total is the
 * sum of its rounded position totals, never the rounded sum of unrounded products.
 */

export type Cents = number & { readonly __brand: "cents" };

export function cents(value: number): Cents {
  if (!Number.isSafeInteger(value)) throw new RangeError(`not a whole number of cents: ${value}`);
  return value as Cents;
}

/** "1.234,56" (German) or "1234.56" (GAEB, API) to cents. */
export function parseEuro(raw: string): Cents {
  const s = raw.trim().replace(/\s|€/g, "");
  if (!/^-?[\d.,]+$/.test(s)) throw new RangeError(`not an amount: ${raw}`);
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalised: string;
  if (lastComma > lastDot) normalised = s.replace(/\./g, "").replace(",", ".");
  else normalised = s.replace(/,/g, "");
  const [whole = "0", frac = ""] = normalised.split(".");
  if (frac.length > 2) {
    // Unit prices with mills are rounded to the cent here, as the platform stores cents.
    return roundHalfAway(Number(normalised) * 100);
  }
  const sign = whole.startsWith("-") ? -1 : 1;
  return cents(sign * (Math.abs(Number(whole)) * 100 + Number(frac.padEnd(2, "0"))));
}

export function roundHalfAway(x: number): Cents {
  const r = Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
  return cents(r === 0 ? 0 : r);
}

/** Position total in cents for a unit price in cents and a quantity (up to 3 decimals). */
export function lineTotal(unitPrice: Cents, quantity: number): Cents {
  // Quantities carry at most three decimals in GAEB; scale to integers to avoid binary drift.
  const qMilli = Math.round(quantity * 1000);
  return roundHalfAway((unitPrice * qMilli) / 1000);
}

export function sum(values: readonly Cents[]): Cents {
  let s = 0;
  for (const v of values) s += v;
  return cents(s);
}

export function formatEuro(value: Cents, locale = "de-DE"): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: "EUR" }).format(value / 100);
}
