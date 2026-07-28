import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

// The public /api/shared-books route runs on the anon client, where RLS hides
// owner-scoped rows. Generated lessons are private, so they get their own route
// that derives identity from the verified JWT and filters by owner explicitly.

// GET /api/lessons — the caller's own generated lessons, newest first.
export async function GET(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен." }, { status: 503 });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ lessons: [] });
  }

  const { data, error } = await supabaseAdmin
    .from("shared_books")
    .select("*")
    .eq("source_type", "generated")
    .eq("owner_user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("lessons GET:", error.message);
    return NextResponse.json({ lessons: [] });
  }

  return NextResponse.json({ lessons: data ?? [] });
}

// DELETE /api/lessons?id=<uuid> — remove one of the caller's own lessons.
export async function DELETE(req: NextRequest) {
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен." }, { status: 503 });
  }

  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // The owner_user_id filter is the authorization check: the admin client
  // bypasses RLS, so without it any id would be deletable.
  const { error } = await supabaseAdmin
    .from("shared_books")
    .delete()
    .eq("id", id)
    .eq("source_type", "generated")
    .eq("owner_user_id", user.id);

  if (error) {
    console.error("lessons DELETE:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
