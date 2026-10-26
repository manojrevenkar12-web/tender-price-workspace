# Working in this repository

Fast feedback:

- `pnpm lint && pnpm format:check && pnpm typecheck` (seconds).
- `pnpm --filter @tpw/domain --filter @tpw/web --filter @tpw/sim test` (seconds, no database).
- `pnpm --filter @tpw/api test` needs Postgres (`TEST_ADMIN_URL`, default
  `postgres://postgres:postgres@localhost:5432/postgres`); it creates and migrates `tpw_test`.
- `pnpm db:seed` then `pnpm --filter @tpw/sim evaluate` for accuracy and speed;
  Cypress runs in CI against a seeded stack (`.github/workflows/ci.yml`).

Invariants (each has a test; keep it that way):

- Tenancy is enforced by row-level security. Request code runs inside `withOrg`, jobs inside
  `withSystem`; never connect as a superuser from the API, never add a query that bypasses them.
- A buyer never sees a draft bid; a rival never sees a tender; matches never show another
  customer's raw position text, only normalised descriptions.
- A market range is published only under the disclosure rule (`DEFAULT_RULE`): at least five
  companies, none above 40 % of the weight. A tender's own bids never feed its own range.
- A price for changed work is never carried into a new BoQ version; a changed quantity keeps it.
- A bid save names the revision it was based on; never let a save overwrite a newer revision.
- Money is integer cents; line totals round half away from zero.
- Only `packages/sim` reads `sim_truth`, imports the simulation or reads the blind wordings
  (`packages/sim/test/cases.test.ts` checks every platform source).
- Thresholds are named constants (`MATCH`, `DEFAULT_RULE`, `ROW_STATS_FROM`), not literals in code.
- Frontend: components use the design tokens (`apps/web/src/shared/theme`), and every screen has
  loading, error-with-retry and empty states.

Held-out rule: never change normalisation, matching or the benchmark to do better on
`packages/sim/blind/phrasings.json`. Its first run is `reports/blind/FIRST_RUN.json` and is never
rewritten. If you study its failures, move it to `packages/sim/regression/` and have someone who
has not seen the code write a new blind set from `packages/sim/blind/BRIEF.md` only.
