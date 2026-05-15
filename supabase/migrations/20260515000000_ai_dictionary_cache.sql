create table if not exists public.ai_dictionary_cache (
  id uuid primary key default gen_random_uuid(),
  word_lower text not null,
  target_language text not null,
  native_language text not null,
  analysis jsonb not null,
  created_at timestamptz not null default now(),
  unique(word_lower, target_language, native_language)
);

-- Открываем публичный доступ на чтение и запись для всех авторизованных пользователей
alter table public.ai_dictionary_cache enable row level security;

create policy "Enable read access for all users"
  on public.ai_dictionary_cache for select
  using (true);

create policy "Enable insert for authenticated users only"
  on public.ai_dictionary_cache for insert
  to authenticated
  with check (true);
