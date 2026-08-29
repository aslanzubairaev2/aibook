-- Server-side cache for Gemini audiobook read-along transcriptions.
-- Without this table, /api/audiobooks/transcribe silently falls through its
-- "table doesn't exist yet" catch block on every request and re-transcribes
-- via the paid Gemini Files API every single time — even for a chapter that
-- was already transcribed a minute earlier. This table is what makes the
-- cache-check in that route actually persist.
create table if not exists public.audiobook_transcripts (
  id uuid primary key default gen_random_uuid(),
  audiobook_id text not null,
  chapter_index integer not null,
  language text not null,
  segments jsonb not null,
  raw_text text,
  model_used text,
  usage jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(audiobook_id, chapter_index)
);

-- Shared, public-domain audio (LibriVox/Internet Archive) transcribed once
-- and reused by every learner — same access pattern as ai_dictionary_cache.
alter table public.audiobook_transcripts enable row level security;

create policy "Enable read access for all users"
  on public.audiobook_transcripts for select
  using (true);

create policy "Enable insert for authenticated users only"
  on public.audiobook_transcripts for insert
  to authenticated
  with check (true);

create policy "Enable update for authenticated users only"
  on public.audiobook_transcripts for update
  to authenticated
  using (true)
  with check (true);
