-- Durable smart-dictionary generation jobs.
-- The browser only starts and observes a job. Vercel Workflow owns the work,
-- so closing a tab cannot interrupt the AI rounds or the already saved words.
CREATE TABLE IF NOT EXISTS public.dictionary_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('single', 'topic')),
  request text NOT NULL,
  input_language text NOT NULL DEFAULT 'auto',
  target_language text NOT NULL,
  native_language text NOT NULL,
  batch_id uuid REFERENCES public.dictionary_batches(id) ON DELETE SET NULL,
  batch_title text NOT NULL DEFAULT '',
  workflow_run_id text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'waiting_input', 'completed', 'failed')),
  current_action text NOT NULL DEFAULT 'Задача поставлена в очередь',
  rounds_completed integer NOT NULL DEFAULT 0,
  total_added integer NOT NULL DEFAULT 0,
  last_words jsonb NOT NULL DEFAULT '[]'::jsonb,
  clarification text,
  hook_token text,
  error text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS dictionary_generation_jobs_user_idx
  ON public.dictionary_generation_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS dictionary_generation_jobs_active_idx
  ON public.dictionary_generation_jobs(user_id, status, updated_at DESC);

ALTER TABLE public.dictionary_generation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own dictionary generation jobs" ON public.dictionary_generation_jobs;
CREATE POLICY "Read own dictionary generation jobs"
  ON public.dictionary_generation_jobs FOR SELECT
  TO authenticated
  USING ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Insert own dictionary generation jobs" ON public.dictionary_generation_jobs;
CREATE POLICY "Insert own dictionary generation jobs"
  ON public.dictionary_generation_jobs FOR INSERT
  TO authenticated
  WITH CHECK ((select auth.uid()) = user_id);

DROP POLICY IF EXISTS "Update own dictionary generation jobs" ON public.dictionary_generation_jobs;
CREATE POLICY "Update own dictionary generation jobs"
  ON public.dictionary_generation_jobs FOR UPDATE
  TO authenticated
  USING ((select auth.uid()) = user_id)
  WITH CHECK ((select auth.uid()) = user_id);

