create extension if not exists pgcrypto;

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  native_language text not null default 'ru',
  target_languages text[] not null default array['de']::text[],
  active_target_lang text not null default 'de',
  ui_language text not null default 'ru',
  updated_at timestamptz not null default now()
);

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  author text,
  language text not null,
  format text not null check (format in ('txt', 'epub')),
  file_path text not null,
  cover_url text,
  total_chars integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.book_chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_index integer not null,
  title text,
  paragraphs jsonb not null default '[]'::jsonb,
  plain_text text not null default '',
  char_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (book_id, chapter_index)
);

create table if not exists public.reading_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  chapter_index integer not null default 0,
  scroll_pos integer not null default 0,
  percentage numeric(5, 2) not null default 0,
  last_read_at timestamptz not null default now(),
  total_time_ms bigint not null default 0,
  unique (user_id, book_id)
);

create table if not exists public.vocabulary_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_id uuid references public.books(id) on delete set null,
  target_language text not null,
  selection_type text not null check (selection_type in ('word', 'phrase', 'sentence')),
  original_text text not null,
  context_sentence text,
  ai_analysis jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vocabulary_item_id uuid references public.vocabulary_items(id) on delete cascade,
  front text not null,
  back text not null,
  repetitions integer not null default 0,
  easiness_factor numeric not null default 2.5,
  interval_days integer not null default 1,
  next_review_at timestamptz,
  last_reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  cards_reviewed integer not null default 0,
  correct_count integer not null default 0
);

create table if not exists public.ai_analysis_cache (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cache_key text not null,
  prompt_version text not null default 'v1',
  source_language text not null,
  target_language text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (user_id, cache_key, prompt_version)
);

create index if not exists books_user_id_idx on public.books(user_id);
create index if not exists book_chapters_book_id_idx on public.book_chapters(book_id);
create index if not exists reading_progress_user_id_idx on public.reading_progress(user_id);
create index if not exists vocabulary_items_user_id_idx on public.vocabulary_items(user_id);
create index if not exists flashcards_user_id_idx on public.flashcards(user_id);
create index if not exists ai_analysis_cache_lookup_idx on public.ai_analysis_cache(user_id, cache_key, prompt_version);

alter table public.user_settings enable row level security;
alter table public.books enable row level security;
alter table public.book_chapters enable row level security;
alter table public.reading_progress enable row level security;
alter table public.vocabulary_items enable row level security;
alter table public.flashcards enable row level security;
alter table public.review_sessions enable row level security;
alter table public.ai_analysis_cache enable row level security;

create policy "Users manage own settings" on public.user_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage own books" on public.books
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage own chapters" on public.book_chapters
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage own reading progress" on public.reading_progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage own vocabulary" on public.vocabulary_items
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage own flashcards" on public.flashcards
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage own review sessions" on public.review_sessions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "Users manage own AI cache" on public.ai_analysis_cache
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
