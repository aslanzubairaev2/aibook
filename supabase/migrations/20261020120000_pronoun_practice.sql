-- «Личные местоимения» in Практика: settings, teacher-assigned sessions and
-- teacher re-grades. Answers themselves go into the shared training_events
-- history (trainer = 'pronouns'); nothing here duplicates it.
--
-- All three tables are read and written only by server routes with the
-- service role: RLS on, no policies.

-- An answer the rules could not judge waits for the teacher instead of being
-- counted as the learner's error.
alter table public.training_events drop constraint if exists training_events_outcome_check;
alter table public.training_events add constraint training_events_outcome_check
  check (outcome in ('correct', 'typo', 'incorrect', 'dont_know', 'skipped', 'technical', 'self_rated', 'needs_review'));

-- Which blocks, verbs and modes are switched on. Absent row = the defaults in lib/pronouns/config.ts.
create table if not exists public.pronoun_practice_config (
  user_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null,
  updated_by text not null default 'learner' check (updated_by in ('learner', 'teacher')),
  updated_at timestamptz not null default now()
);

-- A session the teacher assigned (create_pronoun_practice_session). The app
-- builds its tasks from the catalogue; client_key makes a repeated call a no-op.
create table if not exists public.pronoun_practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_key text,
  settings jsonb not null,
  status text not null default 'assigned' check (status in ('assigned', 'started', 'completed')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists pronoun_practice_sessions_client_key
  on public.pronoun_practice_sessions (user_id, client_key) where client_key is not null;
create index if not exists pronoun_practice_sessions_user on public.pronoun_practice_sessions (user_id, created_at desc);

-- A teacher's correction of an automatic verdict. The event keeps what the
-- rules said; every review is kept, the latest one counts.
create table if not exists public.training_event_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.training_events(id) on delete cascade,
  outcome text check (outcome in ('correct', 'typo', 'incorrect', 'dont_know', 'skipped', 'technical', 'needs_review')),
  components jsonb,
  note text,
  reviewer text not null default 'teacher',
  created_at timestamptz not null default now()
);

create index if not exists training_event_reviews_user on public.training_event_reviews (user_id, created_at desc);
create index if not exists training_event_reviews_event on public.training_event_reviews (event_id, created_at desc);

alter table public.pronoun_practice_config enable row level security;
alter table public.pronoun_practice_sessions enable row level security;
alter table public.training_event_reviews enable row level security;
