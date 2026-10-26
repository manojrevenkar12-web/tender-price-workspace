# 1. Tenancy is enforced by Postgres row-level security

## Context

General contractors, their rivals and dozens of subcontractors share one database. A rival must
never see a tender, a subcontractor must never see another's prices, and a buyer must never see a
bid that is still a draft. Checking this in every handler means one forgotten `WHERE org_id = $1`
leaks a competitor's prices.

## Decision

Every tenant table has row-level security, forced also for the table owner. Each API request runs
in a transaction that sets `app.org_id` with `set_config(..., true)` (`withOrg` in `apps/api/src/db.ts`);
background jobs that must see everything set `app.system` (`withSystem`). A connection that sets
neither sees no tenant rows. The API connects as `tpw_app`, which is not a superuser and cannot
bypass the policies.

Visibility rules live in three security-definer functions (`can_see_tender`, `owns_tender`,
`bid_visible`): a tender is visible to its owner and, once published, to invited companies; a bid
to its bidder and, once submitted, to the buyer. Child tables (`bid_items`, `boq_positions`, ...)
use `EXISTS` policies against their parent so the planner can use the parent's index
(migration 005: bid items for a 2,000 x 25 comparison went from 1.9 s to 0.1 s).

Live events are re-read under each subscriber's own organisation before they are sent, so the
event stream cannot leak what the tables would not show.

## Consequences

- A missing filter in application code returns nothing instead of someone else's data.
  `apps/api/test/tenancy.test.ts` and `apps/web/cypress/e2e/tenancy.cy.ts` check the rules end to end.
- Policies cost time per row; they are written so the planner can push them down (`EXISTS` on
  indexed keys), and slow statements are logged in production (`log_min_duration_statement`).
- Shared reference data (historical prices, price index, regional levels) is not tenant data; it is
  read under `app.system` and never returns another customer's raw text (ADR 2).
