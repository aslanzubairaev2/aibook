create table if not exists public.video_training_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  youtube_id text not null,
  native_language text not null,
  target_language text not null,
  transcript_hash text not null,
  session jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, youtube_id, native_language, target_language, transcript_hash)
);

create index if not exists video_training_progress_user_idx
  on public.video_training_progress (user_id, updated_at desc);

alter table public.video_training_progress enable row level security;

drop policy if exists "Users can read their video training progress" on public.video_training_progress;
create policy "Users can read their video training progress"
  on public.video_training_progress for select using (auth.uid() = user_id);

drop policy if exists "Users can insert their video training progress" on public.video_training_progress;
create policy "Users can insert their video training progress"
  on public.video_training_progress for insert with check (auth.uid() = user_id);

drop policy if exists "Users can update their video training progress" on public.video_training_progress;
create policy "Users can update their video training progress"
  on public.video_training_progress for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users can delete their video training progress" on public.video_training_progress;
create policy "Users can delete their video training progress"
  on public.video_training_progress for delete using (auth.uid() = user_id);
