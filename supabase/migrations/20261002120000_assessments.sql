-- Interactive tests a connected teacher agent builds over MCP and the learner
-- takes inside the app (see docs/assessments-mcp.md).
--
-- Everything here is read and written by server routes with the service role:
-- the content column holds correct answers and hidden listening transcripts,
-- so no table gets a Data API policy — RLS on, no policies, nothing reachable
-- from the browser's anon/JWT client.

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- The agent's idempotency key: repeating create_assessment after a dropped
  -- response returns the same row instead of a duplicate.
  client_key text,
  title text not null,
  description text not null default '',
  language text not null default 'de',
  mode text not null check (mode in ('learning', 'diagnostic')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- Sections and items, answers and transcripts included. Never sent as is.
  content jsonb not null,
  settings jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);

create unique index if not exists assessments_user_client_key
  on public.assessments (user_id, client_key) where client_key is not null;
create index if not exists assessments_user_created on public.assessments (user_id, created_at desc);

-- One generated recording per audio section. spec_hash names the exact
-- request (text, voices, pace, model), so the same audio is never paid twice.
create table if not exists public.assessment_audio (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  section_id text not null,
  spec jsonb not null,
  spec_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'generating', 'ready', 'error')),
  storage_path text,
  duration_ms integer,
  model text,
  error text,
  tries integer not null default 0,
  -- A generation in flight holds the row until this moment; a crashed one is
  -- picked up again once it passes.
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  unique (assessment_id, section_id)
);

create index if not exists assessment_audio_hash on public.assessment_audio (user_id, spec_hash);

create table if not exists public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'reviewed')),
  -- Content and settings frozen when the attempt starts: a later
  -- update_assessment never changes what this attempt is graded against.
  snapshot jsonb not null,
  answers jsonb not null default '{}'::jsonb,
  sections jsonb not null default '{}'::jsonb,
  listens jsonb not null default '{}'::jsonb,
  review jsonb,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  reviewed_at timestamptz
);

create index if not exists assessment_attempts_assessment on public.assessment_attempts (assessment_id, started_at desc);
create index if not exists assessment_attempts_user on public.assessment_attempts (user_id, started_at desc);

alter table public.assessments enable row level security;
alter table public.assessment_audio enable row level security;
alter table public.assessment_attempts enable row level security;

-- Count one listening, atomically: a reload, a second tab or a second device
-- must never reset or race past the limit. Returns the new state, or
-- ok=false when the limit was already reached.
create or replace function public.assessment_start_listen(
  p_attempt uuid,
  p_user uuid,
  p_section text,
  p_max integer
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listens jsonb;
  v_entry jsonb;
  v_used integer;
begin
  select listens into v_listens
    from public.assessment_attempts
    where id = p_attempt and user_id = p_user and status = 'in_progress'
    for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'attempt_closed');
  end if;

  v_entry := coalesce(v_listens -> p_section, '{"used":0,"plays":[]}'::jsonb);
  v_used := coalesce((v_entry ->> 'used')::integer, 0);
  if p_max is not null and v_used >= p_max then
    return jsonb_build_object('ok', false, 'reason', 'limit_reached', 'used', v_used);
  end if;

  v_entry := jsonb_build_object(
    'used', v_used + 1,
    'plays', coalesce(v_entry -> 'plays', '[]'::jsonb) || jsonb_build_array(to_jsonb(now()))
  );
  update public.assessment_attempts
    set listens = coalesce(listens, '{}'::jsonb) || jsonb_build_object(p_section, v_entry),
        updated_at = now()
    where id = p_attempt;
  return jsonb_build_object('ok', true, 'used', v_used + 1);
end;
$$;

revoke all on function public.assessment_start_listen(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.assessment_start_listen(uuid, uuid, text, integer) to service_role;
