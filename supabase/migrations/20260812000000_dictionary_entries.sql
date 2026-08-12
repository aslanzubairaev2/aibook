-- Migration: the learner's own dictionary
--
-- Each row is one word as it would appear in a dictionary — headword with its
-- article, plural, verb forms, translation, CEFR level. One row per word, not
-- one row per photographed page: the whole point is that the words are
-- separate entries that can be searched, filtered and revised individually.
--
-- Kept apart from flashcards on purpose. A flashcard is a scheduling object
-- (due dates, ease factors, lapses); a dictionary entry is reference material.
-- The two are linked by hand — "add to cards" — rather than conflated.

CREATE TABLE IF NOT EXISTS public.dictionary_entries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- "die Öffnungszeit" — what the page shows, article included.
  headword      text        NOT NULL,
  -- "Öffnungszeit" — article and markers stripped, for lookup and dedupe.
  lemma         text        NOT NULL,
  language      text        NOT NULL DEFAULT 'de',

  translation   text        NOT NULL DEFAULT '',
  part_of_speech text       NOT NULL DEFAULT '',
  -- m / f / n / pl for nouns, empty otherwise.
  gender        text        NOT NULL DEFAULT '',
  article       text        NOT NULL DEFAULT '',
  plural        text        NOT NULL DEFAULT '',
  -- Everything a learner needs for an irregular verb: Präteritum, Partizip II,
  -- auxiliary, separability. Free-form so other languages fit too.
  forms         jsonb       NOT NULL DEFAULT '{}'::jsonb,

  cefr          text        NOT NULL DEFAULT '',
  note          text        NOT NULL DEFAULT '',
  example       text        NOT NULL DEFAULT '',
  example_translation text  NOT NULL DEFAULT '',

  -- Where it came from: "photo", the page description, the lesson id.
  source        text        NOT NULL DEFAULT '',
  metadata      jsonb       NOT NULL DEFAULT '{}'::jsonb,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Photographing the same vocabulary page twice must not double the entries.
  UNIQUE (user_id, lemma, language)
);

CREATE INDEX IF NOT EXISTS dictionary_entries_user_idx
  ON public.dictionary_entries(user_id, created_at DESC);

ALTER TABLE public.dictionary_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read own dictionary entries"
  ON public.dictionary_entries FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Insert own dictionary entries"
  ON public.dictionary_entries FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Update own dictionary entries"
  ON public.dictionary_entries FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Delete own dictionary entries"
  ON public.dictionary_entries FOR DELETE USING (auth.uid() = user_id);
