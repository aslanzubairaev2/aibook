-- Which engine the Live Translate screen uses: Gemini's live-translate-preview
-- or OpenAI's gpt-realtime-translate. Sits beside tts_provider for the same
-- reason — the choice should follow the account onto every device, not live
-- in one browser's local storage.

alter table public.user_settings
  add column if not exists live_translate_provider text not null default 'gemini';
