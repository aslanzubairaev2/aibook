-- Hide history entries independently of favorites and saved playback progress.
alter table public.video_library
  add column if not exists hidden_from_history boolean not null default false;
