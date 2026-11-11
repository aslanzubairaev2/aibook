-- Trainer progress that used to live on one device only.
--
-- The Глаголы / Существительные / other-parts-of-speech trainers and the typed
-- answers of the active card trainer kept their schedules in the browser's
-- localStorage: clearing site data or changing phone erased them. Each of
-- those collections is now mirrored here as one JSON document per (user, key);
-- the client merges entry by entry (latest answer wins) before it writes, so
-- two devices never overwrite each other's answers.
--
-- Keys: pack_progress:verbs | pack_progress:nouns | pack_progress:otherpos |
--       card_skill_progress
CREATE TABLE IF NOT EXISTS public.user_progress_state (
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key        text        NOT NULL CHECK (char_length(key) BETWEEN 1 AND 64),
  value      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

ALTER TABLE public.user_progress_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_progress_state FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_progress_state TO authenticated;
GRANT ALL ON TABLE public.user_progress_state TO service_role;

CREATE POLICY "Read own progress state"
  ON public.user_progress_state FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Insert own progress state"
  ON public.user_progress_state FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Update own progress state"
  ON public.user_progress_state FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Delete own progress state"
  ON public.user_progress_state FOR DELETE
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
