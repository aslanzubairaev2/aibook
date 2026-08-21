-- Migration: MCP action log
--
-- Every write an MCP-connected agent makes happens today with no record
-- afterwards: neither the learner nor the agent itself, later in the same
-- conversation, can see what changed, when, or whether it actually
-- succeeded. This is that record — one row per non-read tool call, written
-- centrally by callMcpTool, read back through the get_action_history tool.

CREATE TABLE IF NOT EXISTS public.mcp_action_log (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name      text        NOT NULL,
  args           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  result_summary jsonb,
  ok             boolean     NOT NULL,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_action_log_user_idx
  ON public.mcp_action_log(user_id, created_at DESC);

ALTER TABLE public.mcp_action_log ENABLE ROW LEVEL SECURITY;

-- Written by the MCP server's service-role client, which bypasses RLS; the
-- policy only needs to let the learner read their own trail back in the app.
CREATE POLICY "Read own mcp action log"
  ON public.mcp_action_log FOR SELECT USING (auth.uid() = user_id);
