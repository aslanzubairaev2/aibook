-- Add SM-2 SRS (Spaced Repetition System) fields to flashcards table
ALTER TABLE flashcards 
  ADD COLUMN IF NOT EXISTS repetitions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lapses integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS easiness_factor double precision NOT NULL DEFAULT 2.5,
  ADD COLUMN IF NOT EXISTS interval_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_review_at timestamp with time zone NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_reviewed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS source_book_id uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'new';

-- Optional: Index on next_review_at to optimize queries for cards due today
CREATE INDEX IF NOT EXISTS idx_flashcards_next_review_at ON flashcards (user_id, next_review_at);
