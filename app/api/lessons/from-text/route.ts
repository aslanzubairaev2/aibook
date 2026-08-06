import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runLessonPrompt } from "@/lib/ai/lessonModel";
import { buildLessonFromSourcePrompt } from "@/lib/ai/buildImageLessonPrompt";
import { saveGeneratedLesson } from "@/lib/db/lessonStore";
import type { CefrLevel } from "@/lib/types";

export const dynamic = "force-dynamic";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LENGTHS = ["short", "medium", "long"] as const;

// POST /api/lessons/from-text
// Body: { sourceText, sourceLanguage, targetLanguage, nativeLanguage, level, length }
//
// Second half of the photo flow: builds a lesson out of transcribed text and
// saves it. Split from the image call so picking a language, or retrying a bad
// result, never re-reads the photo.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы создавать уроки." }, { status: 401 });
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

  const body = await req.json() as {
    sourceText?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    nativeLanguage?: string;
    level?: string;
    length?: string;
    sourceKind?: string;
  };

  const sourceText = (body.sourceText ?? "").trim().slice(0, 6000);
  if (!sourceText) {
    return NextResponse.json({ error: "Пустой исходный текст." }, { status: 400 });
  }

  const level = LEVELS.includes(body.level as CefrLevel) ? body.level as CefrLevel : "A2";
  const length = LENGTHS.includes(body.length as typeof LENGTHS[number])
    ? body.length as typeof LENGTHS[number]
    : "medium";
  const targetLanguage = (body.targetLanguage ?? "de").trim();
  const nativeLanguage = (body.nativeLanguage ?? "ru").trim();
  const sourceLanguage = (body.sourceLanguage ?? targetLanguage).trim();

  const prompt = buildLessonFromSourcePrompt({
    sourceText,
    sourceLanguage,
    targetLanguage,
    nativeLanguage,
    level,
    length,
  });

  const result = await runLessonPrompt(apiKey, prompt);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const saved = await saveGeneratedLesson(supabaseAdmin, {
    userId: user.id,
    lesson: result.lesson,
    level,
    targetLanguage,
    nativeLanguage,
    extraMetadata: {
      origin: "photo",
      source_language: sourceLanguage,
      source_kind: (body.sourceKind ?? "").trim().slice(0, 120),
      // The transcription, so a later revision can be checked against what was
      // actually on the page. The photo itself is never stored.
      source_text: sourceText.slice(0, 4000),
    },
  });

  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    id: saved.id,
    title: result.lesson.title,
    description: result.lesson.description,
    paragraphs: saved.paragraphs,
  });
}
