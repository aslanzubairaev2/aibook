-- FSRS memory state for every card and direction.
--
-- FSRS schedules from two numbers per prompt: stability (how many days until
-- recall drops to 90 %) and difficulty (1–10). Both are nullable: a row that
-- has not been reviewed since the switch has none yet, and the app derives
-- them once from the SM-2 fields (interval, ease, lapses) at its next review.
-- easiness_factor stays for older clients and history.

alter table public.flashcards
  add column if not exists stability double precision,
  add column if not exists difficulty double precision;

alter table public.flashcard_variant_progress
  add column if not exists stability double precision,
  add column if not exists difficulty double precision;
