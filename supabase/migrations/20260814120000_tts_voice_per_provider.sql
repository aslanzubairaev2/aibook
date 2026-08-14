-- The voice the learner picked, one per engine.
--
-- Each engine has its own cast — Gemini's Algenib means nothing to ElevenLabs —
-- so a single "voice" column could not hold the choice. The value is an object
-- keyed by provider: {"gemini": "Algenib", "elevenlabs": "CwhRBWXzGAHq8TQ4Fs17"}.
--
-- It sits beside tts_provider so the choice follows the account onto every
-- device, rather than living in one browser's local storage.

alter table public.user_settings
  add column if not exists tts_voices jsonb not null default '{}'::jsonb;

-- And the model, for the same reason: each engine has several, and which one
-- was being tried should follow the account rather than one browser.
alter table public.user_settings
  add column if not exists tts_models jsonb not null default '{}'::jsonb;
