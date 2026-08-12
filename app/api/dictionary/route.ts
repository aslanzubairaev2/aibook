import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { DICTIONARY_COLUMNS } from "@/lib/db/dictionaryStore";

export const dynamic = "force-dynamic";

// GET /api/dictionary?language=de
//
// The learner's own words, newest first. The admin client bypasses RLS, so the
// owner filter is applied explicitly here.
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы открыть словарь." }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ entries: [] });
  }

  const language = req.nextUrl.searchParams.get("language");

  let query = supabaseAdmin
    .from("dictionary_entries")
    .select(DICTIONARY_COLUMNS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (language) query = query.eq("language", language);

  const { data, error } = await query;
  if (error) {
    // The table is added by a migration; say so plainly instead of showing an
    // empty dictionary as if there were nothing in it.
    const missing = error.message.includes("dictionary_entries") || error.code === "PGRST205";
    return NextResponse.json(
      { error: missing ? "Словарь ещё не подключён к базе — нужна миграция." : error.message },
      { status: missing ? 503 : 500 },
    );
  }

  return NextResponse.json({ entries: data ?? [] });
}

// DELETE /api/dictionary?id=…
export async function DELETE(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы менять словарь." }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Не указано слово." }, { status: 400 });

  const { error } = await supabaseAdmin
    .from("dictionary_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
