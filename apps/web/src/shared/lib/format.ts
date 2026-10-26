/** Numbers the way German construction buyers read them. */
const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
const euro0 = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});
const qty = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat("de-DE", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

export const formatCents = (c: number | null | undefined) =>
  c === null || c === undefined ? "–" : euro.format(c / 100);
export const formatCentsRound = (c: number | null | undefined) =>
  c === null || c === undefined ? "–" : euro0.format(c / 100);
export const formatQuantity = (q: number) => qty.format(q);
export const formatPercent = (x: number) => pct.format(x);

/** "1.234,56", "1234,5", "1234.56" -> cents; empty -> null; anything else -> undefined (invalid). */
export function parseCentsInput(raw: string): number | null | undefined {
  const s = raw.trim().replace(/\s|€/g, "");
  if (s === "") return null;
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$|^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const normalised = s.includes(",")
    ? s.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(s)
      ? s.replace(/\./g, "")
      : s;
  const n = Math.round(Number(normalised) * 100);
  return Number.isFinite(n) ? n : undefined;
}

export function centsToInput(c: number | null | undefined): string {
  if (c === null || c === undefined) return "";
  return (c / 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function relativeDeadline(iso: string | null, now = Date.now()): string {
  if (!iso) return "no deadline";
  const days = Math.round((new Date(iso).getTime() - now) / 86_400_000);
  if (days < 0) return `closed ${-days} d ago`;
  if (days === 0) return "due today";
  return `due in ${days} d`;
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
export const formatTime = (iso: string) =>
  new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
