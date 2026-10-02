-- Every answer given in a trainer, as an event — the history the teacher
-- agent reads over MCP (get_training_history / get_training_summary).
--
-- Before this, only aggregates existed: the SM-2 schedule on flashcards and
-- per-word counters in the browser's localStorage. Neither says which article
-- was confused, which Perfekt form was wrong, or whether it was right the
-- first time. Events are written by the browser (queued offline, sent in
-- batches) through /api/training-events; client_event_id makes a resend a
-- no-op instead of a duplicate.

create table if not exists public.training_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id text not null,
  occurred_at timestamptz not null,
  -- The learner's own calendar day, computed on their device: «сегодня» is
  -- their today, not the server's UTC one.
  local_date date not null,
  time_zone text not null default 'UTC',
  -- review | active | nouns | verbs | adjectives | prepositions
  trainer text not null,
  mode text,
  session_id text,
  entry_id uuid,
  card_id uuid,
  word text not null default '',
  -- What exactly was tested: translation, article, plural, word_with_article,
  -- form, conjugation, sentence, adjective_ending, preposition_case,
  -- recognition, recall, listening, spoken_production…
  checks text not null,
  form text,
  pronoun text,
  tense text,
  prompt text,
  answer text,
  expected text,
  -- correct | typo | incorrect | dont_know | skipped | technical | self_rated
  outcome text not null check (outcome in ('correct', 'typo', 'incorrect', 'dont_know', 'skipped', 'technical', 'self_rated')),
  -- 1 = the first time this item was asked in this session; 2+ = a retry round.
  attempt_no integer not null default 1,
  hint_used boolean not null default false,
  answer_shown boolean not null default false,
  -- A flashcard self-rating (1 Не помню … 4 Легко) — never counted as a checked answer.
  self_grade smallint check (self_grade between 1 and 4),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, client_event_id)
);

create index if not exists training_events_user_time on public.training_events (user_id, occurred_at desc);
create index if not exists training_events_user_day on public.training_events (user_id, local_date, trainer);

alter table public.training_events enable row level security;

-- Tests on the home screen are notifications: a test shows there while it is
-- new, and again once its results are out — until they have been looked at.
alter table public.assessment_attempts
  add column if not exists results_seen_at timestamptz;
