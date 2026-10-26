-- Second retrieval path for market prices: historical wordings that share a position's rarest
-- words. Trigram similarity finds typos and close spellings but misses the same work written
-- with other words around it ("Aushub der Baugrube ..." against "Baugrubenaushub ... laden").
ALTER TABLE price_signatures
  ADD COLUMN words text[] GENERATED ALWAYS AS (string_to_array(norm_words, ' ')) STORED;
CREATE INDEX price_signatures_word_array ON price_signatures USING gin (words);
