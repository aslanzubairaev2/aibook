-- Existing public YouTube captions, shared across devices. Never client writable.
create table public.youtube_transcripts (
  video_id text not null check (video_id ~ '^[A-Za-z0-9_-]{11}$'),
  language text not null check (language ~ '^[A-Za-z-]{2,12}$'),
  cues jsonb not null check (jsonb_typeof(cues) = 'array' and jsonb_array_length(cues) > 0),
  created_at timestamptz not null default now(),
  primary key (video_id, language)
);
alter table public.youtube_transcripts enable row level security;
revoke all on public.youtube_transcripts from anon, authenticated;
grant select, insert, update on public.youtube_transcripts to service_role;
comment on table public.youtube_transcripts is 'Durable native YouTube subtitle cache; server only; no automatic expiry.';
