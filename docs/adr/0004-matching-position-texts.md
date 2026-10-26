# 4. Matching position texts: normalise, retrieve two ways, score, keep only near-best

## Context

Estimators write the same work in many ways: "Stb.-Wand C30/37 d=24 cm", "Wand aus Stahlbeton,
Festigkeitsklasse C30/37, 24 cm dick", compounds, abbreviations, typos, and long texts full of
project boilerplate. Prices are only comparable for the same work with the same attributes
(a 24 cm wall is not a 17.5 cm wall).

## Decision

1. **Normalise** (`packages/domain/src/text.ts`): fold umlauts, expand abbreviations, extract
   attributes (concrete class, thickness, DN, cable section, tile format, drywall system, slip
   class, soil class, lengths), split compounds on known heads, apply synonyms, stem lightly.
   Words come from the short text; attributes also from the long text (`normalisePosition`), so
   boilerplate does not drown the match.
2. **Retrieve** candidates with the same unit dimension two ways and merge them: trigram nearest
   neighbours (GiST, `<->`) for typos and close spellings, and wordings that share the position's
   three rarest known words (GIN on a word array) for the same work among other words.
3. **Score** with an IDF-weighted word overlap (typos and compounds count as the same word),
   squared, times an attribute fit that is 0 when a shared attribute disagrees. Words no historical
   wording uses weigh like common words: they say nothing about which wording is meant.
4. **Keep only near-best**: a wording counts only if its weight is at least half the best one's,
   so twelve weak matches of wall formwork cannot outvote one exact concrete-wall match.

Thresholds live in `MATCH` (`apps/api/src/services/pricing.ts`).

## Consequences

- Development wordings: 98 % coverage, every answered median within 10 % of the true price.
  The first blind set (v1) found gaps in step 1 (soil classes as "BK 3-5", "Wanddicke 30 cm",
  cable sections in "qmm", common abbreviations); they were fixed in general form and v1 became a
  regression set. The second blind set's first run: 85 % coverage, every answered median within
  10 % (ADR 7).
- A 2,000-position bill of quantities takes about 40 s in the background job (four connections);
  a single position about 50 ms. The next step for speed is an in-memory candidate index per
  worker or precomputed embeddings; the current cost is mostly the two index searches per position.
