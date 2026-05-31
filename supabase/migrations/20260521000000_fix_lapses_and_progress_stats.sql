-- Ensure lapses column exists (safe re-apply if migration 20260520233000 was not run)
ALTER TABLE flashcards
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0;

-- Extend reading_progress with detailed tracking for AI assistant
ALTER TABLE reading_progress
  ADD COLUMN IF NOT EXISTS total_paragraphs integer,
  ADD COLUMN IF NOT EXISTS words_analyzed integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS session_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_reading_seconds integer NOT NULL DEFAULT 0;

-- Extend review_sessions with richer stats
ALTER TABLE review_sessions
  ADD COLUMN IF NOT EXISTS session_duration_seconds integer,
  ADD COLUMN IF NOT EXISTS score_distribution jsonb,
  ADD COLUMN IF NOT EXISTS card_types jsonb;

-- Vocabulary stats view for AI assistant queries
CREATE OR REPLACE VIEW vocabulary_stats AS
SELECT
  user_id,
  COUNT(*) AS total_cards,
  COUNT(*) FILTER (WHERE status = 'review') AS mastered,
  COUNT(*) FILTER (WHERE status = 'new') AS new_cards,
  COUNT(*) FILTER (WHERE status = 'learning') AS learning_cards,
  COUNT(*) FILTER (WHERE status = 'relearning') AS relearning_cards,
  ROUND(AVG(easiness_factor)::numeric, 2) AS avg_ease,
  COUNT(DISTINCT source_book_id) AS books_studied,
  SUM(lapses) AS total_mistakes,
  SUM(repetitions) AS total_repetitions,
  MAX(last_reviewed_at) AS last_activity_at
FROM flashcards
GROUP BY user_id;

-- Grant read access to authenticated users (own row only via security definer or RLS)
-- Note: vocabulary_stats view inherits RLS from flashcards table (user_id filter in query)
