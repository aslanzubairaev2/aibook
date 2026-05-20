create table if not exists public.ai_discuss_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, cache_key)
);

create index if not exists ai_discuss_history_lookup_idx on public.ai_discuss_history(user_id, cache_key);

alter table public.ai_discuss_history enable row level security;

create policy "Users manage own discuss history" on public.ai_discuss_history
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
