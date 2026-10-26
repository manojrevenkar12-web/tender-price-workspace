import type { Flag } from "@tpw/domain";

import type { Tone } from "../../shared/ui";

export const FLAG: Record<Flag, { label: string; tone: Tone; explain: string; severity: number }> = {
  decimal_slip: {
    label: "Decimal slip?",
    tone: "alert",
    explain: "About 10x or 1/10 of the other bids: probably a typing error.",
    severity: 3,
  },
  zero_price: {
    label: "Zero price",
    tone: "alert",
    explain: "Priced at 0 for work with a quantity.",
    severity: 3,
  },
  outlier_high: {
    label: "Far above bids",
    tone: "caution",
    explain: "More than 3.5 robust standard deviations above the other bids.",
    severity: 2,
  },
  outlier_low: {
    label: "Far below bids",
    tone: "caution",
    explain: "More than 3.5 robust standard deviations below the other bids.",
    severity: 2,
  },
  above_market: {
    label: "Above market",
    tone: "caution",
    explain: "More than 10% above the 90th percentile of comparable historical prices.",
    severity: 1,
  },
  below_market: {
    label: "Below market",
    tone: "caution",
    explain: "More than 10% below the 10th percentile of comparable historical prices.",
    severity: 1,
  },
  stale: {
    label: "Old version",
    tone: "stale",
    explain: "Priced on an earlier version of this position; the work changed in an addendum.",
    severity: 2,
  },
  missing: {
    label: "Not priced",
    tone: "neutral",
    explain: "No price for this position (added in an addendum or left out).",
    severity: 1,
  },
};

export function worst(flags: readonly Flag[]): Flag | null {
  let best: Flag | null = null;
  for (const f of flags) if (!best || FLAG[f].severity > FLAG[best].severity) best = f;
  return best;
}
