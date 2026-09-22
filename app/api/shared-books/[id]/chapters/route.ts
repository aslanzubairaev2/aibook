import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { mergeHomeworkReferenceBank, parseExercise } from "@/lib/ai/buildHomeworkPrompt";

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
    .select("id, owner_user_id, metadata")
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

  let paragraphs: unknown[] = (data ?? []).flatMap((c) => c.paragraphs as unknown[]);

  // Homework stores the reference pack id in the book metadata. Rehydrate
  // the bank on read so lessons saved before the picker was introduced (or
  // opened on another device) still have the words needed by exercises 3c/7.
  const metadata = (book.metadata ?? {}) as Record<string, unknown>;
  const referenceBatchId = typeof metadata.reference_batch_id === "string"
    ? metadata.reference_batch_id.trim()
    : "";
  if (metadata.lesson_kind === "homework" && referenceBatchId && book.owner_user_id) {
    const [batchResult, entriesResult] = await Promise.all([
      supabaseAdmin
        .from("dictionary_batches")
        .select("id")
        .eq("id", referenceBatchId)
        .eq("user_id", book.owner_user_id)
        .maybeSingle(),
      supabaseAdmin
        .from("dictionary_entries")
        .select("headword, lemma, part_of_speech")
        .eq("batch_id", referenceBatchId)
        .eq("user_id", book.owner_user_id)
        .limit(240),
    ]);

    if (batchResult.data && !entriesResult.error) {
      const words = (entriesResult.data ?? [])
        .flatMap((entry) => [entry.headword, entry.lemma])
        .filter((word): word is string => typeof word === "string" && word.trim().length > 0);
      const verbs = (entriesResult.data ?? [])
        .filter((entry) => /(verb|глагол)/iu.test(entry.part_of_speech ?? ""))
        .flatMap((entry) => [entry.headword, entry.lemma])
        .filter((word): word is string => typeof word === "string" && word.trim().length > 0);
      paragraphs = paragraphs.map((raw) => {
        const exercise = parseExercise(raw);
        return exercise ? mergeHomeworkReferenceBank(exercise, words, verbs) : raw;
      });
    }
  }

  return NextResponse.json({ paragraphs });
}
