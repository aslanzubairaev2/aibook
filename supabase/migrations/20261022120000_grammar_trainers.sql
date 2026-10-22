-- «Глаголы и предлоги» and «Артикли и падежи» in Практика: each trainer's
-- settings and the sessions a teacher assigns. Answers go into the shared
-- training_events history (trainer = 'verb_prepositions' | 'articles_cases');
-- teacher re-grades reuse training_event_reviews. Nothing duplicates them.
--
-- Read and written only by server routes with the service role: RLS on, no policies.

-- One row per learner and trainer. Absent row = the defaults in lib/grammar/*.ts.
create table if not exists public.grammar_trainer_config (
  user_id uuid not null references auth.users(id) on delete cascade,
  trainer text not null check (trainer in ('verb_prepositions', 'articles_cases')),
  config jsonb not null,
  updated_by text not null default 'learner' check (updated_by in ('learner', 'teacher')),
  updated_at timestamptz not null default now(),
  primary key (user_id, trainer)
);

-- A session the teacher assigned (create_grammar_trainer_session). The app
-- builds its tasks from the catalogue; client_key makes a repeated call a no-op.
create table if not exists public.grammar_trainer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  trainer text not null check (trainer in ('verb_prepositions', 'articles_cases')),
  client_key text,
  settings jsonb not null,
  status text not null default 'assigned' check (status in ('assigned', 'started', 'completed')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create unique index if not exists grammar_trainer_sessions_client_key
  on public.grammar_trainer_sessions (user_id, trainer, client_key) where client_key is not null;
create index if not exists grammar_trainer_sessions_user on public.grammar_trainer_sessions (user_id, trainer, created_at desc);

alter table public.grammar_trainer_config enable row level security;
alter table public.grammar_trainer_sessions enable row level security;
