import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runLessonPrompt } from "@/lib/ai/lessonModel";
import { vocabMetadata } from "@/lib/text/vocab";
import {
  buildLessonPrompt,
  lessonToParagraphs,
  type LessonRequest,
} from "@/lib/ai/buildLessonPrompt";
import type { CefrLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LENGTHS = ["short", "medium", "long"] as const;

const COVER_COLORS = [
  "linear-gradient(160deg, #c49a28 0%, #7a5c10 100%)",
  "linear-gradient(160deg, #4a7a5c 0%, #254030 100%)",
  "linear-gradient(160deg, #3a5c8a 0%, #1a2c4a 100%)",
  "linear-gradient(160deg, #8a3a3a 0%, #4a1a1a 100%)",
  "linear-gradient(160deg, #6a3a8a 0%, #35174a 100%)",
  "linear-gradient(160deg, #8a5a2a 0%, #4a2a0a 100%)",
];

function pickColor(title: string) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы генерировать уроки." }, { status: 401 });
  }

  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });
  }

  const body = await req.json() as Partial<LessonRequest>;

  const level: CefrLevel = LEVELS.includes(body.level as CefrLevel) ? body.level as CefrLevel : "A2";
  const length = LENGTHS.includes(body.length as typeof LENGTHS[number])
    ? body.length as typeof LENGTHS[number]
    : "medium";
  const topic = (body.topic ?? "").trim().slice(0, 200);
  const targetLanguage = (body.targetLanguage ?? "de").trim();
  const nativeLanguage = (body.nativeLanguage ?? "ru").trim();
  const reviewWords = Array.isArray(body.reviewWords)
    ? body.reviewWords.filter((w): w is string => typeof w === "string").map((w) => w.trim()).filter(Boolean).slice(0, 12)
    : [];
  const context = (body.context ?? "").trim().slice(0, 1000);

  if (!topic) {
    return NextResponse.json({ error: "Укажите тему урока." }, { status: 400 });
  }

  const prompt = buildLessonPrompt({ level, topic, targetLanguage, nativeLanguage, reviewWords, length, context });

  const result = await runLessonPrompt(apiKey, prompt);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const lesson = result.lesson;

  const paragraphs = lessonToParagraphs(lesson);
  const charCount = paragraphs.join("").length;
  // source_id must stay unique per row — UNIQUE (source_type, source_id) is
  // global, not per user.
  const sourceId = `generated_${crypto.randomUUID()}`;

  const { data: bookData, error: bookError } = await supabaseAdmin
    .from("shared_books")
    .insert({
      source_type: "generated",
      source_id: sourceId,
      owner_user_id: user.id,
      title: lesson.title,
      author: "AI",
      language: targetLanguage,
      cefr_level: level,
      course_id: `generated_${user.id}`,
      course_title: "Мои уроки",
      lesson_order: null,
      total_chars: charCount,
      metadata: {
        description: lesson.description,
        cover_color: pickColor(lesson.title),
        topic,
        context,
        // Kept so a later revision can address the learner in the same language
        // without the client having to resend the profile.
        native_language: nativeLanguage,
        review_words: reviewWords,
        // How many leading paragraphs are the reading text itself. Revision
        // needs to feed back the prose without the glossary appended below it.
        body_paragraph_count: lesson.paragraphs.length,
        // Frequency data for the catalogue's "how much of this do you know" badge.
        ...vocabMetadata(lesson.paragraphs.join(" ")),
        generated_at: new Date().toISOString(),
        model: AI_CONFIG.model,
      },
    })
    .select("id")
    .single();

  if (bookError || !bookData) {
    console.error("lessons/generate insert:", bookError?.message);
    return NextResponse.json({ error: "Не удалось сохранить урок." }, { status: 500 });
  }

  const { error: chapterError } = await supabaseAdmin.from("shared_book_chapters").insert({
    shared_book_id: bookData.id,
    chapter_index: 0,
    title: lesson.title,
    paragraphs,
    plain_text: paragraphs.join("\n"),
    char_count: charCount,
  });

  if (chapterError) {
    // Leaving a lesson row with no text would show an unopenable card forever.
    await supabaseAdmin.from("shared_books").delete().eq("id", bookData.id);
    console.error("lessons/generate chapter insert:", chapterError.message);
    return NextResponse.json({ error: "Не удалось сохранить текст урока." }, { status: 500 });
  }

  return NextResponse.json({
    id: bookData.id,
    title: lesson.title,
    description: lesson.description,
    cefr_level: level,
    paragraphs,
  });
}
