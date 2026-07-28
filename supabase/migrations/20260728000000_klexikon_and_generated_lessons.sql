-- Migration: retire the Wikibooks scrape, add Klexikon + AI-generated lessons
--
-- Background: the "wikibooks" source scraped en.wikibooks.org, i.e. an English
-- course *about* German. Grammar tables were stripped by the HTML cleaner, so
-- what landed in the reader was English prose with the useful parts missing.
-- It is replaced by two clearly separated sources:
--   * 'klexikon'  — authentic German written for children (klexikon.zum.de),
--                   CC BY-SA, public content shared by all users
--   * 'generated' — lessons generated per user by the AI pipeline, private to
--                   their author (owner_user_id)

-- ============================================================
-- 1. Drop retired Wikibooks content
-- ============================================================
-- Chapters and lesson progress cascade from shared_books.
DELETE FROM shared_books WHERE source_type = 'wikibooks';

-- ============================================================
-- 2. Allow the new source types
-- ============================================================
ALTER TABLE shared_books DROP CONSTRAINT IF EXISTS shared_books_source_type_check;

ALTER TABLE shared_books
  ADD CONSTRAINT shared_books_source_type_check
  CHECK (source_type IN ('klexikon', 'universal_cefr', 'oersi', 'dw', 'generated'));

-- ============================================================
-- 3. Owner-scoped rows (AI-generated lessons)
-- ============================================================
-- NULL owner_user_id = public content (Klexikon, UniversalCEFR, OERSI).
-- Non-NULL = private lesson, visible only to its author.
ALTER TABLE shared_books
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS shared_books_owner_idx
  ON shared_books(owner_user_id) WHERE owner_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS shared_books_source_type_idx
  ON shared_books(source_type);

-- Generated lessons have no meaningful source_id, so the UNIQUE (source_type,
-- source_id) constraint would collide across users on NULL-ish values. Give
-- each generated lesson a unique source_id at insert time instead (the app
-- uses `generated_<uuid>`); nothing to change in the schema here.

-- ============================================================
-- 4. Personal library accepts the new sources
-- ============================================================
-- books.source_type is set when a shared lesson is saved into a user's own
-- library. 'wikibooks' stays in the list: existing user rows still carry it and
-- the ALTER would fail on them otherwise.
ALTER TABLE public.books DROP CONSTRAINT IF EXISTS books_source_type_check;

ALTER TABLE public.books
  ADD CONSTRAINT books_source_type_check
  CHECK (source_type IN (
    'upload', 'gutenberg', 'standard_ebooks',
    'wikibooks', 'oersi', 'universal_cefr',
    'klexikon', 'generated'
  ));

-- ============================================================
-- 5. RLS: public rows stay public, owned rows are private
-- ============================================================
DROP POLICY IF EXISTS "Public read shared_books" ON shared_books;

CREATE POLICY "Read public or own shared_books"
  ON shared_books FOR SELECT
  USING (owner_user_id IS NULL OR owner_user_id = auth.uid());

CREATE POLICY "Users delete own shared_books"
  ON shared_books FOR DELETE
  USING (owner_user_id = auth.uid());

DROP POLICY IF EXISTS "Public read shared_book_chapters" ON shared_book_chapters;

CREATE POLICY "Read public or own shared_book_chapters"
  ON shared_book_chapters FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM shared_books b
      WHERE b.id = shared_book_chapters.shared_book_id
        AND (b.owner_user_id IS NULL OR b.owner_user_id = auth.uid())
    )
  );
