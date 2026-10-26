# 6. Frontend: feature folders, design tokens, server state in TanStack Query, self-hosted fonts

## Decision

- **Feature-first folders** (`apps/web/src/features/{auth,tenders,comparison,bidding,pricecheck}`),
  each with its own API hooks, components and styles; shared building blocks in `shared/ui`,
  `shared/api`, `shared/lib`, `shared/theme`. Routes are code-split per role, so a bidder never
  downloads the buyer's comparison grid.
- **Design tokens** (`shared/theme/tokens.css`, `tokens.ts`): colour, type scale, spacing, radii,
  durations and grid sizes are named once; components use only tokens. The palette is the
  comparison's own language: market green for the market range, ochre for stale prices, red for
  slips and outliers.
- **Server state** lives in TanStack Query; local state only for what the user is typing. The bid
  editor autosaves with the revision it last saw and handles 409 conflicts (ADR 3).
- **Every screen** has a loading skeleton, an error state with retry, and an empty state
  (`QueryState`); `apps/web/cypress/e2e/states.cy.ts` checks them.
- **Motion** (framer-motion) is used where it explains a change: page reveals, the market drawer,
  banners for addenda and conflicts. Reduced motion is respected.
- **Large grids** (2,000 positions x 25 bids) are virtualised (TanStack Virtual) with sticky
  position and bid columns.
- **Fonts are self-hosted** (`@fontsource-variable/archivo`): no request to Google Fonts, which
  German courts have treated as a transfer of the visitor's IP address without consent.
