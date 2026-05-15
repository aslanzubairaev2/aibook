CREATE TABLE IF NOT EXISTS public.ai_tts_cache (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  text text NOT NULL,
  lang text NOT NULL,
  voice_name text NOT NULL,
  audio_base64 text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  UNIQUE(text, lang, voice_name)
);

ALTER TABLE public.ai_tts_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow public read ai_tts_cache" ON public.ai_tts_cache FOR SELECT USING (true);
CREATE POLICY "Allow public insert ai_tts_cache" ON public.ai_tts_cache FOR INSERT WITH CHECK (true);
