-- Migration: shared cache for the AI-generated audiobook overview card
--
-- Every open of an audiobook's detail panel used to call Gemini again for the
-- same "О чём / Жанр / Язык / Кому" card, even though the text does not
-- depend on who is looking or which device they are on. Keying on the
-- catalog's own stable identifier (the Internet Archive item id) means the
-- card is generated once per book, ever, and every later open — on any
-- device, by any user — is a free read.
--
-- Mirrors ai_dictionary_cache / ai_tts_cache: public read, public insert, no
-- user column, since the content itself carries no per-user information.

CREATE TABLE IF NOT EXISTS public.ai_audiobook_overview_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  audiobook_id  text        NOT NULL,
  title         text        NOT NULL,
  author        text        NOT NULL,
  language      text        NOT NULL,
  review        text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (audiobook_id)
);

ALTER TABLE public.ai_audiobook_overview_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read ai_audiobook_overview_cache"
  ON public.ai_audiobook_overview_cache FOR SELECT USING (true);

CREATE POLICY "Allow public insert ai_audiobook_overview_cache"
  ON public.ai_audiobook_overview_cache FOR INSERT WITH CHECK (true);
