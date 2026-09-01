create table if not exists public.ai_fast_word_cache (
  word_lower text not null,
  target_language text not null,
  native_language text not null,
  response jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (word_lower, target_language, native_language)
);

alter table public.ai_fast_word_cache enable row level security;

drop policy if exists "Allow public read ai_fast_word_cache" on public.ai_fast_word_cache;
create policy "Allow public read ai_fast_word_cache"
  on public.ai_fast_word_cache for select using (true);

drop policy if exists "Allow public insert ai_fast_word_cache" on public.ai_fast_word_cache;
create policy "Allow public insert ai_fast_word_cache"
  on public.ai_fast_word_cache for insert with check (true);

drop policy if exists "Allow public update ai_fast_word_cache" on public.ai_fast_word_cache;
create policy "Allow public update ai_fast_word_cache"
  on public.ai_fast_word_cache for update using (true) with check (true);
