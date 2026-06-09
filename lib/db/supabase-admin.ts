import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
// IMPORTANT: do NOT fall back to the anon key here. The admin client must bypass
// RLS; with the anon key it silently returns 0 rows for server-side reads
// (no auth.uid()), which masks a missing SUPABASE_SERVICE_ROLE_KEY as "empty data".
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

export const isAdminConfigured = Boolean(supabaseUrl && serviceRoleKey);

