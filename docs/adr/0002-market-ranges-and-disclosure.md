# 2. Market ranges are adjusted, trimmed per company, and only published when nobody can be traced

## Context

Two million historical unit prices are the product's moat, and they are other customers' bids.
A range built from three companies' prices tells a buyer what those three companies charge. Prices
also come from different years and regions, and some are typed wrong by a factor of ten.

## Decision

`packages/domain/src/benchmark.ts`:

1. **Adjust** every price to the target quarter with the construction price index and to the target
   region with estimated regional price levels (the platform estimates its own levels from the
   history; it never sees the simulation's true ones).
2. **Trim per company**: robust z-scores on log prices with a MAD floor of 0.15 remove decimal
   slips and speculative prices; a company counts as at most three independent prices.
3. **Publish only when** at least 5 companies contribute, no company carries more than 40 % of the
   weight, and there are at least 6 effective points. Otherwise the answer is `suppressed` with a
   reason (`too_few_companies`, `dominant_company`, `too_few_points`, `no_data`).
4. **Round** published quantiles (`publishRound`) so no single bid can be read back.
5. Matches are shown as normalised descriptions (`stahlbeton wand (thickness mm 240)`), never as
   another customer's raw position text.
6. A tender's own bids never feed its own benchmark (`excludeTender`), and awarded tenders join the
   history once, idempotently (`contribute_prices`).

## Consequences

- Some positions get no range; the UI says why instead of showing a number it cannot stand behind.
- The evaluation (`reports/EVALUATION.md`) checks that no published range rests on fewer than five
  companies, and measures how often the true price lies inside p10-p90.
