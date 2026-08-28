-- TTS audio is server-only. Existing audio_base64 values are intentionally
-- retained for staged rollback and are never deleted by this migration.
alter table public.ai_tts_cache
  add column if not exists storage_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tts-audio', 'tts-audio', false, 10485760,
  array['audio/mpeg', 'audio/wav', 'audio/wave', 'audio/x-wav', 'application/octet-stream']
)
on conflict (id) do update set
  name = excluded.name,
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- The route uses service_role, so no storage.objects policy is needed. Remove
-- the old public table policies: they exposed the legacy audio column through
-- the Data API while the staged server fallback still needs to read it.
drop policy if exists "Allow public read ai_tts_cache" on public.ai_tts_cache;
drop policy if exists "Allow public insert ai_tts_cache" on public.ai_tts_cache;
drop policy if exists "Allow public update ai_tts_cache" on public.ai_tts_cache;
