import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import {
  adoptCardsIntoPack,
  DICTIONARY_COLUMNS,
  findOrCreatePack,
  readBatches,
  updateEntryForms,
  updateEntryNoun,
} from "@/lib/db/dictionaryStore";

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

  const [{ data, error }, { batches }] = await Promise.all([
    query,
    readBatches(supabaseAdmin, user.id, { language }),
  ]);
  if (error) {
    // The table is added by a migration; say so plainly instead of showing an
    // empty dictionary as if there were nothing in it.
    const missing = error.message.includes("dictionary_entries") || error.code === "PGRST205";
    return NextResponse.json(
      { error: missing ? "Словарь ещё не подключён к базе — нужна миграция." : error.message },
      { status: missing ? 503 : 500 },
    );
  }

  return NextResponse.json({ entries: data ?? [], batches: batches ?? [] });
}

// POST /api/dictionary   { title, language? }
//
// Turns a group of cards that merely share a source name into the pack it
// already is to the learner.
//
// Such groups appear whenever cards are added under a source without asking for
// a pack — an assistant that filled in `source` and not `batch_title`, or cards
// left behind by a pack that was deleted. The screen has always shown them as
// packs, with progress and a «тренировать» button, but there was no row behind
// them, so they could not be described, configured or removed: the learner was
// left looking at a pack with no way to act on it.
export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы менять словарь." }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });
  }

  const body = await req.json() as { title?: string; language?: string };
  const title = (body.title ?? "").trim().slice(0, 200);
  if (!title) return NextResponse.json({ error: "Не указана пачка." }, { status: 400 });

  // The pack is created in the language the screen is showing, so it is not
  // filtered straight back out of the list it was made for.
  const language = (body.language ?? "").trim() || "de";

  const pack = await findOrCreatePack(supabaseAdmin, user.id, {
    title,
    kind: "от ИИ-ассистента",
    language,
  });
  if (!pack.ok) return NextResponse.json({ error: pack.error }, { status: 500 });

  const adoption = await adoptCardsIntoPack(supabaseAdmin, user.id, title, pack.id);
  if (adoption.error) {
    return NextResponse.json(
      { error: `Не удалось привязать карточки к пачке: ${adoption.error}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: pack.id, title, adopted: adoption.adopted });
}

// DELETE /api/dictionary?id=…            — one entry
// DELETE /api/dictionary?batchId=…       — a whole batch and its entries
//                                          (the flashcards made from it stay:
//                                          learning progress is not something
//                                          a cleanup should destroy)
export async function DELETE(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы менять словарь." }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });
  }

  const batchId = req.nextUrl.searchParams.get("batchId");
  if (batchId) {
    await supabaseAdmin.from("dictionary_entries").delete().eq("batch_id", batchId).eq("user_id", user.id);
    const { error } = await supabaseAdmin.from("dictionary_batches").delete().eq("id", batchId).eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
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

// PATCH /api/dictionary   body: { id, forms?, noun? }
//
// Backfills what a dictionary entry was saved without: the principal parts of a
// verb (`forms`, merged into whatever it already has) or the gender/article/
// plural of a noun (`noun`, only the fields that actually carry a value).
// Never a blind overwrite in either case.
export async function PATCH(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы менять словарь." }, { status: 401 });
  }
  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });
  }

  const body = await req.json() as {
    id?: string;
    forms?: Record<string, string>;
    noun?: { gender?: string; article?: string; plural?: string };
  };
  const id = (body.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Не указано слово." }, { status: 400 });

  if (body.noun && typeof body.noun === "object") {
    const error = await updateEntryNoun(supabaseAdmin, user.id, id, body.noun);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const forms = body.forms && typeof body.forms === "object" ? body.forms : {};

  const error = await updateEntryForms(supabaseAdmin, user.id, id, forms);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ ok: true });
}
