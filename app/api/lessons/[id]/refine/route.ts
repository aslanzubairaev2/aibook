import { NextRequest, NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runLessonPrompt } from "@/lib/ai/lessonModel";
import { vocabMetadata } from "@/lib/text/vocab";
import {
  buildLessonRefinePrompt,
  lessonToParagraphs,
  extractLessonBody,
} from "@/lib/ai/buildLessonPrompt";
import type { CefrLevel } from "@/lib/types";

export const dynamic = "force-dynamic";
// Reading an image, or writing a document from it, routinely takes longer than
// the 10-second default: without this the platform kills the function mid-call
// and the browser reports only "Failed to fetch". 60s is the ceiling on the
// Hobby plan.
export const maxDuration = 60;


// POST /api/lessons/<id>/refine
// Body: { instructions: string }
//
// Rewrites one of the caller's own generated lessons from their notes ("my
// friend runs a flower shop, and we live together"). The lesson keeps its id,
// so reading progress and any open reader stay pointed at the same row.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы редактировать уроки." }, { status: 401 });
  }

  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Access Denied" }, { status: 403 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });
  }

  const body = await req.json() as { instructions?: string };
  const instructions = (body.instructions ?? "").trim().slice(0, 2000);
  if (!instructions) {
    return NextResponse.json({ error: "Опишите, что нужно изменить." }, { status: 400 });
  }

  // The owner filter is the authorization check — the admin client bypasses RLS.
  const { data: lessonRow, error: lessonError } = await supabaseAdmin
    .from("shared_books")
    .select("id, title, language, cefr_level, metadata")
    .eq("id", id)
    .eq("source_type", "generated")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (lessonError || !lessonRow) {
    return NextResponse.json({ error: "Урок не найден." }, { status: 404 });
  }

  const { data: chapter } = await supabaseAdmin
    .from("shared_book_chapters")
    .select("paragraphs")
    .eq("shared_book_id", id)
    .eq("chapter_index", 0)
    .maybeSingle();

  const stored = (chapter?.paragraphs as string[] | undefined) ?? [];
  if (stored.length === 0) {
    return NextResponse.json({ error: "У урока нет текста." }, { status: 404 });
  }

  const metadata = (lessonRow.metadata ?? {}) as Record<string, unknown>;
  const bodyCount = typeof metadata.body_paragraph_count === "number" ? metadata.body_paragraph_count : undefined;
  const currentParagraphs = extractLessonBody(stored, bodyCount);

  const prompt = buildLessonRefinePrompt({
    level: (lessonRow.cefr_level as CefrLevel) ?? "A2",
    targetLanguage: lessonRow.language ?? "de",
    nativeLanguage: (metadata.native_language as string) ?? "ru",
    currentParagraphs,
    instructions,
  });

  const result = await runLessonPrompt(apiKey, prompt);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const lesson = result.lesson;

  const paragraphs = lessonToParagraphs(lesson);
  const charCount = paragraphs.join("").length;

  const { error: chapterError } = await supabaseAdmin
    .from("shared_book_chapters")
    .update({
      title: lesson.title,
      paragraphs,
      plain_text: paragraphs.join("\n"),
      char_count: charCount,
    })
    .eq("shared_book_id", id)
    .eq("chapter_index", 0);

  if (chapterError) {
    console.error("lessons/refine chapter update:", chapterError.message);
    return NextResponse.json({ error: "Не удалось сохранить изменённый текст." }, { status: 500 });
  }

  const revisions = typeof metadata.revisions === "number" ? metadata.revisions : 0;
  await supabaseAdmin
    .from("shared_books")
    .update({
      title: lesson.title,
      total_chars: charCount,
      metadata: {
        ...metadata,
        description: lesson.description,
        body_paragraph_count: lesson.paragraphs.length,
        ...vocabMetadata(lesson.paragraphs.join(" ")),
        revisions: revisions + 1,
        last_revised_at: new Date().toISOString(),
        last_revision_note: instructions,
        model: AI_CONFIG.model,
      },
    })
    .eq("id", id);

  // The rewrite can be shorter than the original, which would leave a saved
  // reading position past the end of the text. Pull it back in range.
  const { data: progress } = await supabaseAdmin
    .from("user_lesson_progress")
    .select("paragraph_index")
    .eq("user_id", user.id)
    .eq("shared_book_id", id)
    .maybeSingle();

  if (progress && progress.paragraph_index >= paragraphs.length) {
    await supabaseAdmin
      .from("user_lesson_progress")
      .update({ paragraph_index: Math.max(0, paragraphs.length - 1), char_offset: 0 })
      .eq("user_id", user.id)
      .eq("shared_book_id", id);
  }

  return NextResponse.json({
    id,
    title: lesson.title,
    description: lesson.description,
    paragraphs,
  });
}
