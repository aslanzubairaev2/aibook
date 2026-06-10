import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

// GET /api/lesson-progress
// Identity comes from the verified Supabase JWT (Authorization: Bearer <token>),
// never from query params — the admin client bypasses RLS, so trusting a
// client-supplied user_id would let anyone read other users' progress.
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    // Misconfiguration (e.g. SUPABASE_SERVICE_ROLE_KEY missing) — fail loudly
    // instead of returning empty progress that looks like "no lessons done".
    console.error("lesson-progress GET: supabaseAdmin not configured (missing SUPABASE_SERVICE_ROLE_KEY)");
    return NextResponse.json({ error: "Service role not configured" }, { status: 503 });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("user_lesson_progress")
    .select("*")
    .eq("user_id", user.id);

  if (error) {
    console.error("lesson-progress GET:", error.message);
    return NextResponse.json({ progress: [] });
  }

  return NextResponse.json({ progress: data ?? [] });
}

// POST /api/lesson-progress
// Body: { shared_book_id, status, paragraph_index, char_offset, percentage, words_analyzed }
// user_id is always taken from the verified JWT.
export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    shared_book_id: string;
    status: string;
    paragraph_index?: number;
    char_offset?: number;
    percentage?: number;
    words_analyzed?: number;
    completed_at?: string | null;
  };

  const { shared_book_id, status } = body;
  if (!shared_book_id) {
    return NextResponse.json({ error: "shared_book_id is required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("user_lesson_progress")
    .upsert({
      user_id: user.id,
      shared_book_id,
      status,
      paragraph_index: body.paragraph_index ?? 0,
      char_offset: body.char_offset ?? 0,
      percentage: body.percentage ?? 0,
      words_analyzed: body.words_analyzed ?? 0,
      last_read_at: new Date().toISOString(),
      completed_at: status === "completed" ? (body.completed_at ?? new Date().toISOString()) : null,
    }, { onConflict: "user_id,shared_book_id" });

  if (error) {
    console.error("lesson-progress POST:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
