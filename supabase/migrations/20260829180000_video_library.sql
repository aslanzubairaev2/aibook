create table if not exists public.video_library (
  user_id uuid not null references auth.users(id) on delete cascade,
  youtube_id text not null,
  title text not null,
  channel text not null,
  language text not null,
  duration text not null default '0:00',
  thumbnail_url text,
  description text,
  cefr_level text not null default 'all',
  category text not null default 'dialogues',
  is_favorite boolean not null default false,
  last_position_seconds numeric not null default 0,
  max_position_seconds numeric not null default 0,
  progress_percent numeric not null default 0,
  last_cue_index integer,
  last_cue_text text,
  last_watched_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, youtube_id)
);

create index if not exists video_library_recent_idx
  on public.video_library (user_id, last_watched_at desc);

alter table public.video_library enable row level security;

drop policy if exists "Users can read their video library" on public.video_library;
create policy "Users can read their video library"
  on public.video_library for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their video library" on public.video_library;
create policy "Users can insert their video library"
  on public.video_library for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their video library" on public.video_library;
create policy "Users can update their video library"
  on public.video_library for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their video library" on public.video_library;
create policy "Users can delete their video library"
  on public.video_library for delete using (auth.uid() = user_id);
