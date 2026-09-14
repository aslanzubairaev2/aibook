-- Distinguish the four kinds of material the learner can save and practise.
--
-- `word`, `phrase` and `sentence` already exist in older app data. The new
-- `expression` value is for a fixed expression, idiom, collocation or formula
-- such as "Auf Wiederhören!". Dictionary entries need the same information as
-- flashcards so both screens can filter the learner's material consistently.

ALTER TABLE public.dictionary_entries
  ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'word';

UPDATE public.dictionary_entries
SET content_type = 'word'
WHERE content_type IS NULL OR content_type NOT IN ('word', 'phrase', 'sentence', 'expression');

ALTER TABLE public.dictionary_entries
  DROP CONSTRAINT IF EXISTS dictionary_entries_content_type_check;

ALTER TABLE public.dictionary_entries
  ADD CONSTRAINT dictionary_entries_content_type_check
  CHECK (content_type IN ('word', 'phrase', 'sentence', 'expression'));

-- The original schema did not declare selection_type on flashcards even though
-- the application has always read and written it. Add it for older installs and
-- allow the same four values as the client-side model.
ALTER TABLE public.flashcards
  ADD COLUMN IF NOT EXISTS selection_type text NOT NULL DEFAULT 'word';

UPDATE public.flashcards
SET selection_type = 'word'
WHERE selection_type IS NULL OR selection_type NOT IN ('word', 'phrase', 'sentence', 'expression');

ALTER TABLE public.flashcards
  DROP CONSTRAINT IF EXISTS flashcards_selection_type_check;

ALTER TABLE public.flashcards
  ADD CONSTRAINT flashcards_selection_type_check
  CHECK (selection_type IN ('word', 'phrase', 'sentence', 'expression'));

-- Keep the legacy vocabulary table valid for clients that still write it.
ALTER TABLE public.vocabulary_items
  DROP CONSTRAINT IF EXISTS vocabulary_items_selection_type_check;

ALTER TABLE public.vocabulary_items
  ADD CONSTRAINT vocabulary_items_selection_type_check
  CHECK (selection_type IN ('word', 'phrase', 'sentence', 'expression'));
