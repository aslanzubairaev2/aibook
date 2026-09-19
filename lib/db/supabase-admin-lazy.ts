import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cachedAdmin: SupabaseClient | null | undefined;

/**
 * The Workflow sandbox evaluates imported modules without WebSocket support.
 * Do not create a Supabase client at module load time in code reachable from a
 * workflow; create it only after execution has entered a `use step` function.
 */
export function getLazySupabaseAdmin(): SupabaseClient | null {
  if (cachedAdmin !== undefined) return cachedAdmin;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  cachedAdmin = url && serviceRoleKey
    ? createClient(url, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;
  return cachedAdmin;
}
