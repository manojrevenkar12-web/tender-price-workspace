-- Nearest-neighbour trigram search (ORDER BY norm_words <-> words) needs a GiST index; it returns
-- the same 60 most similar wordings as the GIN-filtered sort, three to four times faster.
CREATE INDEX price_signatures_trgm_knn ON price_signatures USING gist (norm_words gist_trgm_ops);
DROP INDEX IF EXISTS price_signatures_words;
