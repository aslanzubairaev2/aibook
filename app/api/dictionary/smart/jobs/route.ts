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
  return NextResponse.json({ jobs: data ?? [] });
}
