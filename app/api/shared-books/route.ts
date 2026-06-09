import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") ?? "";
  const sourceType = searchParams.get("source_type") ?? "";
  const language = searchParams.get("language") ?? "";
  const cefrLevel = searchParams.get("cefr_level") ?? "";
  const courseId = searchParams.get("course_id") ?? "";

  if (!supabase) {
    return NextResponse.json({ books: [] });
  }

  let query = supabase
    .from("shared_books")
    .select("*")
    .order("lesson_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  if (id) query = query.eq("id", id);
  if (sourceType) query = query.eq("source_type", sourceType);
  if (language) query = query.eq("language", language);
  if (cefrLevel) query = query.eq("cefr_level", cefrLevel);
  if (courseId) query = query.eq("course_id", courseId);

  const { data, error } = await query;

  if (error) {
    console.error("shared-books API:", error.message);
    return NextResponse.json({ books: [] });
  }

  return NextResponse.json({ books: data ?? [] });
}
