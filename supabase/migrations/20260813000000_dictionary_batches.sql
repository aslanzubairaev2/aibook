-- Migration: dictionary entries grouped into batches ("пачки")
--
-- One photograph is one batch. A page of coursebook vocabulary is a unit of
-- work — the words you were told to learn by Thursday — and a dictionary that
-- pours every photo into one long list destroys exactly that. With batches the
-- learner opens the dictionary and sees "страница 56, 38 слов, выучено 40%",
-- which is a decision they can act on.
--
-- Flashcards gain two things: the batch they came from (so the deck can be
-- filtered down to one page's words) and the CEFR level of the word (so the
-- deck can be filtered by level at all).

CREATE TABLE IF NOT EXISTS public.dictionary_batches (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text        NOT NULL DEFAULT '',
  -- What the page was: "страница учебника", "страница книги", "меню".
  kind          text        NOT NULL DEFAULT '',
  -- What the words are about, in the learner's language: "свободное время".
  topic         text        NOT NULL DEFAULT '',
  language      text        NOT NULL DEFAULT 'de',
  word_count    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dictionary_batches_user_idx
  ON public.dictionary_batches(user_id, created_at DESC);

ALTER TABLE public.dictionary_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own dictionary batches"
  ON public.dictionary_batches FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Insert own dictionary batches"
  ON public.dictionary_batches FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Update own dictionary batches"
  ON public.dictionary_batches FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Delete own dictionary batches"
  ON public.dictionary_batches FOR DELETE USING (auth.uid() = user_id);

-- Which page a word came from. Null for entries added before batches existed.
ALTER TABLE public.dictionary_entries
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.dictionary_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS dictionary_entries_batch_idx
  ON public.dictionary_entries(batch_id);

-- The deck needs both to be filterable the way the dictionary is: by the page
-- the words came from, and by how hard the word is.
ALTER TABLE public.flashcards
  ADD COLUMN IF NOT EXISTS cefr text;

CREATE INDEX IF NOT EXISTS flashcards_source_book_idx
  ON public.flashcards(user_id, source_book_id);
