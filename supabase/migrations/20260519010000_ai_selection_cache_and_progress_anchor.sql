alter table public.reading_progress add column if not exists paragraph_index integer not null default 0;
alter table public.reading_progress add column if not exists char_offset integer not null default 0;

create table if not exists public.ai_selection_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  selection_type text not null check (selection_type in ('word', 'phrase', 'sentence')),
  response jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.ai_selection_cache enable row level security;

create policy "Allow public read ai_selection_cache"
  on public.ai_selection_cache for select
  using (true);

create policy "Allow public insert ai_selection_cache"
  on public.ai_selection_cache for insert
  with check (true);

create policy "Allow public update ai_selection_cache"
  on public.ai_selection_cache for update
  using (true)
  with check (true);
