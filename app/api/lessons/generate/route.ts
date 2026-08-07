import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runLessonPrompt } from "@/lib/ai/lessonModel";
import { saveGeneratedLesson } from "@/lib/db/lessonStore";
import { buildLessonPrompt, type LessonRequest } from "@/lib/ai/buildLessonPrompt";
import type { CefrLevel } from "@/lib/types";

export const dynamic = "force-dynamic";
// Reading an image, or writing a document from it, routinely takes longer than
// the 10-second default: without this the platform kills the function mid-call
// and the browser reports only "Failed to fetch". 60s is the ceiling on the
// Hobby plan.
export const maxDuration = 60;


const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const LENGTHS = ["short", "medium", "long"] as const;

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

  const saved = await saveGeneratedLesson(supabaseAdmin, {
    userId: user.id,
    lesson,
    level,
    targetLanguage,
    nativeLanguage,
    extraMetadata: {
      origin: "topic",
      topic,
      context,
      review_words: reviewWords,
    },
  });

  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    id: saved.id,
    title: lesson.title,
    description: lesson.description,
    cefr_level: level,
    paragraphs: saved.paragraphs,
  });
}
