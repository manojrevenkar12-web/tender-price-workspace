import type { Tone } from "../../shared/ui";
import type { TenderStatus } from "../../shared/api/types";

export const STATUS: Record<TenderStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  open: { label: "Open for bids", tone: "market" },
  closed: { label: "Closed", tone: "stale" },
  awarded: { label: "Awarded", tone: "ink" },
};

export const TRADE_LABEL: Record<string, string> = {
  concrete: "Concrete and masonry",
  drywall: "Drywall",
  tiling: "Tiling",
  electrical: "Electrical",
  general: "Several trades",
  painting: "Painting",
  plumbing: "Plumbing",
  earthworks: "Earthworks",
};
