# Tender price workspace

A bid-comparison workspace for German construction tenders. A general contractor publishes a
bill of quantities (GAEB DA XML or by hand), invites subcontractors, changes the BoQ with addenda
while bids come in, and compares the bids position by position against market ranges built from
two million historical unit prices. Subcontractors price their bid in the browser or with an X84
file and always price the current version.

It is built the way a product team would ship it: TypeScript end to end (React, Node, Postgres),
tenancy enforced by the database, accuracy measured against a simulated market with a blind test
set, and the deployment described as code (Docker, Kubernetes, Terraform for AWS, CI).

## Results

From `reports/EVALUATION.md` (regenerate with `pnpm --filter @tpw/sim evaluate` on a seeded database):

| wording set                                                     |   coverage | median error | within 10 % | true price inside p10-p90 | matches on the same kind of work |
| --------------------------------------------------------------- | ---------: | -----------: | ----------: | ------------------------: | -------------------------------: |
| dev (used while building the matcher)                           |     97.6 % |        1.4 % |       100 % |                     100 % |                            100 % |
| blind v1, first run                                             |     85.8 % |        1.6 % |      89.8 % |                    99.6 % |                           99.7 % |
| blind v1 after its failures were fixed (now a regression set)   |     94.0 % |        1.3 % |       100 % |                     100 % |                           99.9 % |
| **blind v2, first run** (new wordings, written after the fixes) | **85.2 %** |    **1.3 %** |   **100 %** |                 **100 %** |                       **99.9 %** |

- Each blind set was written from `packages/sim/blind/BRIEF.md` alone by an author who saw neither
  the code nor the history wordings. v1's first run missed soil classes written "BK 3-5", thicknesses
  written "Wanddicke 30 cm", cable sections in "qmm" and abbreviations such as Hlz, ZE, WT, UV, Cu and
  AIV; those were fixed in general form, v1 became a regression set, and v2 was written fresh
  (`docs/adr/0007`).
- On v2's first run every published range had its median within 10 % of the true price. What it
  still misses shows up as coverage: 15 % of positions get no range, mostly wordings that share
  too few words with the history (gravel bases written "Kies..." where the history says
  "Schotter..."). The platform says so instead of guessing.
- Coverage is the share of positions that get a published range; the rest are suppressed with a
  reason (fewer than five companies, one company dominating, no matching history).
- Comparison of 2,000 positions x 25 bids: 245 ms p50 in process, 0.6 MB over the wire (gzip).
- Pricing one position: about 50 ms. Pricing a 2,000-position BoQ in the background job: about 40 s.

| suite                        | tests | what it covers                                                                                                                                                                                                    |
| ---------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/domain`            |    86 | units, money, GAEB X83/X84, text normalisation and matching, addenda, comparison flags, benchmark and disclosure control                                                                                          |
| `apps/api` (Postgres)        |    39 | row-level-security tenancy, tenders, addenda and rebasing, revision conflicts, X84 import, awards and idempotent contributions, market ranges, jobs (retry, SKIP LOCKED), live events under RLS, sign-in, metrics |
| `apps/web`                   |    24 | price input parsing, loading/error/empty states, price strip, flags, the bid editor's autosave and conflict handling                                                                                              |
| `packages/sim`               |    11 | evaluation cases and metrics, truth isolation (no platform file reads the simulation's truth)                                                                                                                     |
| Cypress (`apps/web/cypress`) |    17 | the buyer's comparison and market drawer, addenda, autosave, conflicts, submit, tenancy, loading and error states, on a seeded stack                                                                              |

## What it does

**Buyers (general contractors)**

- Create a tender from a GAEB X83 file or positions, publish it with a deadline, invite companies.
- Review findings on each position: what a bidder would have to guess (no concrete class, no
  thickness, no DN, tile format missing, lump sums). An optional Claude explainer rewrites long
  texts in plain words; it never decides anything.
- Publish addenda; the dialog shows each change and how many submitted bids it affects.
- The comparison (Preisspiegel): every position against every bid, with flags for decimal slips,
  outliers, prices above or below the market range, zero prices, stale prices and gaps; a market
  drawer per position with the range, its sources in normalised form, and why a range is missing.
  Bids are ranked on a comparable total that fills gaps with the other bids' median.
- Award a bid; the awarded prices join the history once.

**Bidders (subcontractors)**

- See invitations, price positions with autosave, import and export X84.
- After an addendum, see which positions changed: changed work needs a new price, a changed
  quantity keeps the price, new positions are marked.
- If a colleague saved in between, the editor stops and offers to load their version instead of
  overwriting it.

## Architecture

```
apps/web (React 19, Vite)            apps/api (Fastify 5, Node 22)                  Postgres 17
  features/                          routes ── zod schemas, OpenAPI at /api/docs/json
    tenders   comparison  ──HTTP──▶  services/                                    row-level security
    bidding   pricecheck   ◀─SSE──     tenders, bids, comparison                 (app.org_id per tx)
    auth                               pricing ── normalise, retrieve, score ──▶  price_signatures
  shared/ui, theme tokens              jobs ── SKIP LOCKED worker               price_points (2M)
                                       events ── LISTEN/NOTIFY → SSE            jobs, events
packages/domain (pure TypeScript)    apps/api/src/worker.ts (scales apart)
  gaeb, units, money, text,
  addenda, comparison, benchmark     packages/sim: simulated market, seed, evaluation (reads sim_truth)
```

Decisions, each with its reasons and consequences, in `docs/adr/`:

1. [Tenancy is enforced by Postgres row-level security](docs/adr/0001-tenancy-in-postgres.md)
2. [Market ranges: adjusted, trimmed per company, published only when nobody can be traced](docs/adr/0002-market-ranges-and-disclosure.md)
3. [Addenda are versions; bids are rebased; revisions prevent lost updates](docs/adr/0003-addenda-and-bid-rebase.md)
4. [Matching position texts](docs/adr/0004-matching-position-texts.md)
5. [Jobs and live events run on Postgres](docs/adr/0005-jobs-and-live-events-on-postgres.md)
6. [Frontend architecture, design tokens, self-hosted fonts](docs/adr/0006-frontend-architecture.md)
7. [Accuracy is measured against a simulation's truth, with a blind set](docs/adr/0007-evaluation-with-a-blind-set.md)

## Run it

With Docker:

```sh
docker compose up -d --build
docker compose --profile demo run --rm seed   # 2M historical prices and the demo tenders, about 2 minutes
open http://localhost:8080                    # pick a demo user
```

For development (Node 22.22+, pnpm 10, a local Postgres with user `postgres`):

```sh
pnpm install
pnpm db:seed                                   # migrates, loads history and demo data
DEMO_MODE=true pnpm --filter @tpw/api dev      # API on :4000
pnpm --filter @tpw/web dev                     # web on :5173
```

Tests:

```sh
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                                      # all unit and database suites (API tests need Postgres: TEST_ADMIN_URL)
pnpm --filter @tpw/web exec cypress run        # against a seeded stack, see .github/workflows/ci.yml
pnpm --filter @tpw/sim evaluate                # accuracy and speed reports
```

## Deploy

- `Dockerfile`: `api` (also runs the worker and migrations), `web` (unprivileged nginx serving the
  build and proxying `/api`, with CSP and SSE-safe proxying) and `tools` (seed, evaluation).
- `deploy/k8s`: kustomize base and a production overlay: API with HPA, PDB and zone spread; a
  separate worker; a pre-sync migration job; ALB ingress; network policies; restricted pod
  security; secrets from AWS Secrets Manager through the External Secrets Operator.
- `deploy/terraform`: VPC over three zones, EKS with arm64 nodes, RDS Postgres 17 (multi-AZ,
  encrypted, 14-day backups), ECR with immutable tags and scanning, and the app's secret. State in S3.
- `.github/workflows/ci.yml`: lint, format, types and unit tests; API tests on Postgres; Cypress on a
  seeded stack followed by the evaluation; `terraform validate` and kubeconform; image build and a
  smoke test of the built images against Postgres.

## Settings

All from the environment (`apps/api/src/config.ts`): `DATABASE_URL`, `MIGRATION_DATABASE_URL`,
`APP_DB_PASSWORD`, `TOKEN_SECRET` (production refuses the development default), `CORS_ORIGIN`,
`RUN_WORKER`, `DEMO_MODE` (e-mail-only sign-in for seeded users; off by default), `METRICS_TOKEN`,
`ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` (optional explainer). Matching thresholds are named in
`MATCH` (`apps/api/src/services/pricing.ts`) and disclosure rules in `DEFAULT_RULE`
(`packages/domain/src/benchmark.ts`).

## Limits

- The data is simulated: 32 kinds of work in 9 trades, invented companies (`.example` domains).
  Real tender texts are longer and more varied; the blind set is the best available estimate.
- Sign-in is by password (scrypt) or, in a demo deployment, by e-mail alone. Single sign-on
  (SAML/OIDC) would issue the same token in front of the same row-level security; it is not built.
- The database connection encrypts but does not verify the server certificate
  (`sslmode=require` with libpq semantics); production should mount the RDS CA bundle and use
  `verify-full`.
- Pricing a very large BoQ takes about 40 s in the background; the buyer sees the ranges arrive
  over the live event stream. An in-memory candidate index per worker would cut that further.
- About 15 % of positions written in unseen ways get no market range (see Results).
