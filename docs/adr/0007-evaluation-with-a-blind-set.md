# 7. Accuracy is measured against a simulation's truth, with a blind set nobody tunes against

## Context

"The benchmark looks plausible" is not evidence. Real historical prices with known true market
prices do not exist, and a matcher tuned on the wordings it is tested on will look better than it
is.

## Decision

- `packages/sim` simulates a construction market: 32 kinds of work in 9 trades, attribute-driven
  prices, a construction price index, regional levels, 2,400 companies with their own price
  levels, typos and decimal slips. The true prices and which signature is which kind of work go to
  the `sim_truth` schema. Only `packages/sim` reads it; `packages/sim/test/cases.test.ts` fails if any
  platform source mentions it, imports the simulation, or reads the blind wordings.
- Two wording sets: `dev` (in the catalog, used while building the matcher) and `blind`
  (`packages/sim/blind/phrasings.json`, written from `blind/BRIEF.md` alone by an author who saw
  neither the history wordings nor the matcher).
- `pnpm --filter @tpw/sim evaluate` writes `reports/EVALUATION.md` and `reports/evaluation.json`.
  The first blind run is written to `reports/blind/FIRST_RUN.json` and never rewritten.
- If the blind set's failures are studied to change the matcher, the set becomes a regression set
  and a new blind set is written from the brief by someone who has not seen the code.

## What happened

The first blind set (v1, first run: 85.8 % coverage, 89.8 % within 10 %) showed gaps in
normalisation. They were studied and fixed in general form, v1 moved to
`packages/sim/regression/blind-v1` with its first run in `reports/regression/blind-v1/`, and a new
author wrote v2 from the brief alone. v2's first run: 85.2 % coverage, 100 % within 10 %.

## Consequences

- The README's accuracy numbers can be reproduced from a fresh seed.
- The blind result is lower than the dev result, and the difference is the honest estimate of how
  the matcher does on wordings it has not seen.
