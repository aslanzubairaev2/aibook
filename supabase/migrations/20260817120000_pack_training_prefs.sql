-- Migration: a pack can say how it wants to be trained
--
-- A batch used to be one photographed page of nouns, and one global set of
-- trainer filters was enough for all of them. It is not: a pack of phrases the
-- learner asked their assistant to build ("я хочу переводить их с русского")
-- needs the reverse direction and nothing else, while the page of nouns beside
-- it is a recognition exercise. Storing that on the pack means «тренировать»
-- opens the trainer already set up the way that pack is meant to be drilled,
-- and the learner's own filters stay their own — they apply to every pack that
-- has no preference of its own.
--
-- Shape (all keys optional):
--   { "variants": ["forward"|"reverse"|"audio"], "type": "all|word|phrase|sentence",
--     "status": "all|new|learning|review|relearning|hard",
--     "mode": "recognize|active", "note": "…" }
--
-- Read back through lib/cards.ts:normalizePackTraining, which drops anything it
-- does not recognise — the values drive the training queue, and a bad one would
-- quietly empty it.

ALTER TABLE public.dictionary_batches
  ADD COLUMN IF NOT EXISTS training jsonb NOT NULL DEFAULT '{}'::jsonb;

-- A pack no longer has to be a page of dictionary words. Cards an assistant
-- builds from phrases or whole sentences are a pack too — they just have no
-- dictionary entries behind them — so the stored word count stops being the
-- measure of whether a batch has anything in it.
COMMENT ON COLUMN public.dictionary_batches.word_count IS
  'Dictionary entries in this pack. A pack of phrase/sentence flashcards has 0 here; its size is the number of flashcards pointing at it via source_book_id.';
