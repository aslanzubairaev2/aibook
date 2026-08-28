// Shared cache for the AI-generated audiobook overview card.
//
// The card's content depends only on the book, never on who is asking, so it
// is keyed on the catalog's own stable id and shared by every user and every
// device — see the migration for why that id (not a hash) is safe to use as
// the key.

import { supabaseAdmin } from "@/lib/db/supabase-admin";

export async function sbGetCachedAudiobookOverview(audiobookId: string): Promise<string | null> {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin
    .from("ai_audiobook_overview_cache")
    .select("review")
    .eq("audiobook_id", audiobookId)
    .maybeSingle<{ review: string }>();
  return data?.review ?? null;
}

/** Best-effort write: a failed cache write costs a repeat charge later, never the request. */
export async function sbSaveCachedAudiobookOverview(
  audiobookId: string,
  title: string,
  author: string,
  language: string,
  review: string,
): Promise<void> {
  if (!supabaseAdmin) return;
  const { error } = await supabaseAdmin
    .from("ai_audiobook_overview_cache")
    .upsert(
      { audiobook_id: audiobookId, title, author, language, review },
      { onConflict: "audiobook_id" },
    );
  if (error) console.error("sbSaveCachedAudiobookOverview error:", error.message);
}
