import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Войдите, чтобы открыть задачи словаря." }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ jobs: [] });

  const { data, error } = await supabaseAdmin
    .from("dictionary_generation_jobs")
    .select("id, status, mode, request, batch_id, batch_title, current_action, rounds_completed, total_added, last_words, clarification, error, result, created_at, updated_at")
    .eq("user_id", user.id)
    .in("status", ["queued", "running", "waiting_input"])
    .order("created_at", { ascending: false })
    .limit(5);
  if (error) return NextResponse.json({ error: "Не удалось прочитать фоновые задачи." }, { status: 500 });

  // A failed job is useful context after a reload, but old terminal jobs must
  // not hijack the add modal. Keep only recent failures and opt into them
  // explicitly so the dictionary screen can explain what happened.
  const includeRecent = new URL(req.url).searchParams.get("includeRecent") === "1";
  let recentFailures: typeof data = [];
  if (includeRecent) {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const failed = await supabaseAdmin
      .from("dictionary_generation_jobs")
      .select("id, status, mode, request, batch_id, batch_title, current_action, rounds_completed, total_added, last_words, clarification, error, result, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("status", "failed")
      .gte("updated_at", since)
      .order("updated_at", { ascending: false })
      .limit(5);
    if (failed.error) return NextResponse.json({ error: "Не удалось прочитать фоновые задачи." }, { status: 500 });
    recentFailures = failed.data ?? [];
  }

  return NextResponse.json({ jobs: [...(data ?? []), ...recentFailures] });
}
