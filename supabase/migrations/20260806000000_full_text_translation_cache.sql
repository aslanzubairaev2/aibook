-- Migration: cache for whole-text translations
--
-- Translating a book costs real money, so it must never be paid for twice.
-- Keying on a hash of the paragraph itself (not on a book id) means the cache
-- is shared by everyone reading the same passage, and survives a text being
-- re-imported under a new id.
--
-- Mirrors ai_tts_cache: public read, public insert, no user column.

CREATE TABLE IF NOT EXISTS public.text_translation_cache (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_hash   text        NOT NULL,   -- sha-256 of the source paragraph
  source_lang   text        NOT NULL,
  target_lang   text        NOT NULL,
  translated    text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_hash, source_lang, target_lang)
);

ALTER TABLE public.text_translation_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read text_translation_cache"
  ON public.text_translation_cache FOR SELECT USING (true);

CREATE POLICY "Allow public insert text_translation_cache"
  ON public.text_translation_cache FOR INSERT WITH CHECK (true);

CREATE INDEX IF NOT EXISTS text_translation_cache_lookup_idx
  ON public.text_translation_cache(source_hash, target_lang);
