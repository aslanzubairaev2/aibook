import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";

export const dynamic = "force-dynamic";

// GET /api/lesson-progress?user_id=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("user_id");

  if (!supabaseAdmin || !userId) {
    return NextResponse.json({ progress: [] });
  }

  // Admin client bypasses RLS; we still scope strictly by the requested user_id.
  const { data, error } = await supabaseAdmin
    .from("user_lesson_progress")
    .select("*")
    .eq("user_id", userId);

  if (error) {
    console.error("lesson-progress GET:", error.message);
    return NextResponse.json({ progress: [] });
  }

  return NextResponse.json({ progress: data ?? [] });
}

// POST /api/lesson-progress
// Body: { user_id, shared_book_id, status, paragraph_index, char_offset, percentage, words_analyzed }
export async function POST(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 503 });
  }

  const body = await req.json() as {
    user_id: string;
    shared_book_id: string;
    status: string;
    paragraph_index?: number;
    char_offset?: number;
    percentage?: number;
    words_analyzed?: number;
    completed_at?: string | null;
  };

  const { user_id, shared_book_id, status } = body;
  if (!user_id || !shared_book_id) {
    return NextResponse.json({ error: "user_id and shared_book_id are required" }, { status: 400 });
  }

  const { error } = await supabaseAdmin
    .from("user_lesson_progress")
    .upsert({
      user_id,
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
