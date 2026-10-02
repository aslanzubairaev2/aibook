-- Speaking tasks and word marks for interactive tests.
--
-- speech: per item, every recording the learner sent — storage path, the raw
-- Azure Pronunciation Assessment answer, its normalized scores and per-word
-- errors, or a technical status (silence, bad format, service failure) that is
-- never treated as a low score.
-- word_marks: words the learner tapped inside a task — «не знаю это слово» or
-- «показать перевод» — so the teacher agent learns exactly what was unknown.
alter table public.assessment_attempts
  add column if not exists speech jsonb not null default '{}'::jsonb,
  add column if not exists word_marks jsonb not null default '{}'::jsonb;
