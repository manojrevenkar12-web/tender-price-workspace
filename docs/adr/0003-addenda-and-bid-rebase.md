# 3. Addenda are versions; bids are rebased, and only prices for changed work are dropped

## Context

Buyers change a bill of quantities while bids are coming in (Nachtrag). Bidders who already
submitted priced the old version. Throwing all their prices away is wrong; keeping a price for work
that changed is worse, because the comparison then ranks a price for different work.

## Decision

Every addendum is a new BoQ version. `diffVersions` classifies each position as added, removed,
quantity changed or work changed, where "work" is a hash of the normalised short and long text,
unit and kind (`workHash`). A price stands for a quantity change (the unit price is still the
bidder's price for that work), and is dropped for a work change.

Bids carry the version they were priced on. Saving or submitting rebases the bid to the current
version (`bids.rebase`); the comparison marks prices as current, requantified, stale or missing,
and ranks on a comparable total that fills gaps with the other bids' median, so a bid with gaps does
not look cheapest.

Bids also carry a revision. A save names the revision it was based on; if a colleague saved in
between, the server answers 409 `revision_conflict` and the editor stops and asks to load their
version instead of overwriting it.

## Consequences

- Bidders see exactly which positions need a new price (`apps/web/src/features/bidding/BidPage.tsx`),
  and the buyer's addendum dialog says how many submitted bids are affected.
- `apps/api/test/tenders.test.ts` covers rebasing, stale prices and conflicts;
  `apps/web/cypress/e2e/addendum.cy.ts` and `bidding.cy.ts` cover them in the browser.
