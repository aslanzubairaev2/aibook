import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

// Serves chapter text for both public content (Klexikon, UniversalCEFR) and
// private AI-generated lessons. The admin client bypasses RLS, so ownership is
// checked here explicitly: a row with a non-null owner_user_id is only readable
// by that user.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (!supabaseAdmin || !id) {
    return NextResponse.json({ paragraphs: [] });
  }

  const { data: book, error: bookError } = await supabaseAdmin
    .from("shared_books")
    .select("id, owner_user_id")
    .eq("id", id)
    .maybeSingle();

  if (bookError || !book) {
    return NextResponse.json({ paragraphs: [] });
  }

  if (book.owner_user_id) {
    const user = await getUserFromRequest(req);
    if (!user || user.id !== book.owner_user_id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }

  const { data, error } = await supabaseAdmin
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
