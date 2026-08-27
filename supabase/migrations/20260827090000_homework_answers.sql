-- Migration: store the learner's own homework answers alongside progress
--
-- A homework exercise set (shared_books.metadata.lesson_kind = 'homework') is
-- filled in over possibly several sittings, on possibly different devices, and
-- the point of the feature is that nothing gets typed for the learner — so
-- what they typed has to survive as reliably as everything else in the app
-- does. user_lesson_progress already tracks percentage per (user, lesson);
-- this adds the one thing it was missing to be that lesson's source of truth:
-- the answers themselves.
--
-- Shape (written and read entirely by the client, opaque to the server):
--   {
--     "items": { "<exerciseNumber>:<itemNumber>": "text" | ["blank0", "blank1", ...] },
--     "conjugations": { "<exerciseNumber>:<verb>": ["ich-form", "du-form", ...] }
--   }

ALTER TABLE user_lesson_progress
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb;
