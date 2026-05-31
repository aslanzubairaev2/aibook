-- Migration: Shared content tables + user lesson progress
-- Purpose: Store Wikibooks/UniversalCEFR/OERSI content once for all users,
--          track per-user lesson completion separately.

-- ============================================================
-- 1. SHARED BOOKS (system content, no user_id, public read)
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_books (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title          text        NOT NULL,
  author         text,
  language       text        NOT NULL,
  cefr_level     text        CHECK (cefr_level IN ('A1','A2','B1','B2','C1','C2')),
  source_type    text        NOT NULL CHECK (source_type IN ('wikibooks','universal_cefr','oersi','dw')),
  source_id      text,                      -- original ID / URL in the source system
  course_id      text,                      -- groups lessons into a course, e.g. 'de_wikibooks_daf'
  course_title   text,                      -- human-readable course name
  lesson_order   integer,                   -- sort order within the course
  cover_url      text,
  total_chars    integer     DEFAULT 0,
  metadata       jsonb       DEFAULT '{}',  -- extra data: topics, license, resource_type, etc.
  created_at     timestamptz DEFAULT now(),
  UNIQUE (source_type, source_id)
);

ALTER TABLE shared_books ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read shared_books"
  ON shared_books FOR SELECT USING (true);

-- ============================================================
-- 2. SHARED BOOK CHAPTERS (mirrors book_chapters, no user_id)
-- ============================================================
CREATE TABLE IF NOT EXISTS shared_book_chapters (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  shared_book_id  uuid    NOT NULL REFERENCES shared_books(id) ON DELETE CASCADE,
  chapter_index   integer NOT NULL,
  title           text,
  paragraphs      jsonb   NOT NULL DEFAULT '[]',
  plain_text      text,
  char_count      integer DEFAULT 0,
  UNIQUE (shared_book_id, chapter_index)
);

ALTER TABLE shared_book_chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read shared_book_chapters"
  ON shared_book_chapters FOR SELECT USING (true);

CREATE INDEX IF NOT EXISTS shared_book_chapters_book_idx
  ON shared_book_chapters(shared_book_id);

-- ============================================================
-- 3. USER LESSON PROGRESS (per-user tracking for shared content)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_lesson_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_book_id  uuid        NOT NULL REFERENCES shared_books(id) ON DELETE CASCADE,
  status          text        NOT NULL DEFAULT 'not_started'
                              CHECK (status IN ('not_started','in_progress','completed')),
  paragraph_index integer     DEFAULT 0,
  char_offset     integer     DEFAULT 0,
  percentage      numeric(5,2) DEFAULT 0,
  words_analyzed  integer     DEFAULT 0,
  last_read_at    timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz DEFAULT now(),
  UNIQUE (user_id, shared_book_id)
);

ALTER TABLE user_lesson_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own lesson progress"
  ON user_lesson_progress FOR ALL USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS user_lesson_progress_user_idx
  ON user_lesson_progress(user_id);

CREATE INDEX IF NOT EXISTS user_lesson_progress_book_idx
  ON user_lesson_progress(shared_book_id);

-- ============================================================
-- 4. USER OERSI INTERACTIONS (viewed / saved / completed)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_oersi_interactions (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  oersi_id   text        NOT NULL,
  status     text        NOT NULL DEFAULT 'viewed'
                         CHECK (status IN ('viewed','saved','completed')),
  viewed_at  timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, oersi_id)
);

ALTER TABLE user_oersi_interactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own oersi interactions"
  ON user_oersi_interactions FOR ALL USING (user_id = auth.uid());
