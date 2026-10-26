/** The numbers motion and layout code needs, mirrored from tokens.css. */
export const motion = {
  fast: 0.12,
  base: 0.22,
  slow: 0.42,
  ease: [0.2, 0.8, 0.2, 1] as const,
  stagger: 0.035,
} as const;

export const layout = {
  /** Height of one comparison-grid row in px (tokens.css --grid-row-height at 16 px root). */
  gridRowHeight: 40,
  gridOverscan: 12,
  autosaveDelayMs: 700,
} as const;
