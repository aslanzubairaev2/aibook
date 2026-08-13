import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

// Lists shared content. Public rows (Klexikon, UniversalCEFR, OERSI) have
// owner_user_id NULL and are visible to everyone; AI-generated lessons are
// owner-scoped and only come back for their author, whose identity is taken
// from the verified JWT — the admin client bypasses RLS, so the filter below is
// the access check.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  const sourceType = searchParams.get("source_type") ?? "";
  const language = searchParams.get("language") ?? "";
  const cefrLevel = searchParams.get("cefr_level") ?? "";
  const courseId = searchParams.get("course_id") ?? "";
  // Title search. PostgREST parses the filter value itself, so characters that
  // are syntax there — the wildcards and the list punctuation — are stripped
  // rather than escaped; a reader typing them means them literally anyway.
  const search = (searchParams.get("q") ?? "").trim().replace(/[%_*,()"]/g, " ").trim();
  const orderBy = searchParams.get("order_by") ?? "";

  if (!supabaseAdmin) {
    return NextResponse.json({ books: [] });
  }

  const user = await getUserFromRequest(req);

  // Paged, and counted: the CEFR shelf alone is hundreds of rows, each
  // carrying its word-frequency map, so fetching the lot to show eighteen
  // tiles moved megabytes per tab switch.
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 500, 1), 500);
  const offset = Math.max(Number(req.nextUrl.searchParams.get("offset")) || 0, 0);

  let query = supabaseAdmin.from("shared_books").select("*", { count: "exact" });

  // The CEFR shelf has no course and no lesson order, so import order — every
  // German text, then every English one — decided what a page held. Ordering it
  // the way the shelf draws it means a page is one stretch of one level.
  query = orderBy === "level"
    ? query
        .order("cefr_level", { ascending: true, nullsFirst: false })
        .order("language", { ascending: true })
        .order("title", { ascending: true })
    : query
        .order("lesson_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

  query = user
    ? query.or(`owner_user_id.is.null,owner_user_id.eq.${user.id}`)
    : query.is("owner_user_id", null);

  if (id) query = query.eq("id", id);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (language) query = query.eq("language", language);
  if (cefrLevel) query = query.eq("cefr_level", cefrLevel);
  if (courseId) query = query.eq("course_id", courseId);
  if (search) query = query.ilike("title", `%${search}%`);

  const { data, error, count } = await query.range(offset, offset + limit - 1);

  if (error) {
    console.error("shared-books API:", error.message);
    return NextResponse.json({ books: [] });
  }

  return NextResponse.json({ books: data ?? [], total: count ?? (data?.length ?? 0) });
}
