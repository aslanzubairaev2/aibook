import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!supabase || !id) {
    return NextResponse.json({ paragraphs: [] });
  }

  const { data, error } = await supabase
    .from("shared_book_chapters")
    .select("paragraphs, plain_text")
    .eq("shared_book_id", id)
    .order("chapter_index", { ascending: true });

  if (error) {
    console.error("shared-books chapters API:", error.message);
    return NextResponse.json({ paragraphs: [] });
  }

  const paragraphs = (data ?? []).flatMap((c) => c.paragraphs as string[]);
  return NextResponse.json({ paragraphs });
}
