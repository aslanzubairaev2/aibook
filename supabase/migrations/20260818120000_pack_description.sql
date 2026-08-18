-- Migration: a pack can say what it is and what it was built to hold
--
-- A pack's title is all it has ever carried, and a title is not enough to
-- come back to it a month later. The packs the learner has built with their
-- assistant were each made to a specification — «аккузатив, только мужской
-- род, одно прилагательное или без прилагательного, единственное число» —
-- and that specification is precisely what tells one shelf of German nouns
-- from the next.
--
--   description — one or two sentences, in the learner's language, saying what
--                 this pack is. Shown under the title on the Словарь screen.
--   instruction — the brief the pack was built to: the exact wording of what
--                 was asked for, so the learner can see it and an assistant can
--                 extend the pack later without being told again.
--
-- Both are written by whoever creates the pack — the photo flow fills the
-- description from what it read, an assistant fills both from the request it
-- was given.

ALTER TABLE public.dictionary_batches
  ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS instruction text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.dictionary_batches.description IS
  'What this pack is, in the learner''s language. One or two sentences, shown under the pack title.';
COMMENT ON COLUMN public.dictionary_batches.instruction IS
  'The brief this pack was built to — the criteria its words or phrases had to meet.';
