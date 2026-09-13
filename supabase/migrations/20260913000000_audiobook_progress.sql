-- Shared resume points for the public Internet Archive/LibriVox catalogue.
-- The audio files themselves stay external; this table stores only per-user
-- learning state so web, Android and future desktop clients can resume the
-- same chapter.
create table if not exists public.audiobook_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  audiobook_id text not null,
  chapter_index integer not null default 0 check (chapter_index >= 0),
  current_time_seconds numeric not null default 0 check (current_time_seconds >= 0),
  duration_seconds numeric not null default 0 check (duration_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, audiobook_id)
);

create index if not exists audiobook_progress_user_updated_idx
  on public.audiobook_progress (user_id, updated_at desc);

alter table public.audiobook_progress enable row level security;

drop policy if exists "Users can read their audiobook progress" on public.audiobook_progress;
create policy "Users can read their audiobook progress"
  on public.audiobook_progress for select using ((select auth.uid()) = user_id);

drop policy if exists "Users can insert their audiobook progress" on public.audiobook_progress;
create policy "Users can insert their audiobook progress"
  on public.audiobook_progress for insert with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their audiobook progress" on public.audiobook_progress;
create policy "Users can update their audiobook progress"
  on public.audiobook_progress for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their audiobook progress" on public.audiobook_progress;
create policy "Users can delete their audiobook progress"
  on public.audiobook_progress for delete using ((select auth.uid()) = user_id);
