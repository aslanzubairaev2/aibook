import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runLessonPrompt } from "@/lib/ai/lessonModel";
import { buildDocumentFromSourcePrompt } from "@/lib/ai/buildImageLessonPrompt";
import { saveGeneratedLesson } from "@/lib/db/lessonStore";
import { estimateLevel } from "@/lib/text/readability";
import { lessonFromTranscription } from "@/lib/ai/transcriptionLesson";

export const dynamic = "force-dynamic";
// Reading an image, or writing a document from it, routinely takes longer than
// the 10-second default: without this the platform kills the function mid-call
// and the browser reports only "Failed to fetch". 60s is the ceiling on the
// Hobby plan.
export const maxDuration = 60;


// POST /api/lessons/from-text
// Body: { sourceText, sourceLanguage, targetLanguage, nativeLanguage, sourceKind }
//
// Second half of the photo flow: restores (or translates) a photographed
// document and saves it. Split from the image call so picking a language, or
// retrying a bad result, never re-reads the photo.
//
// Note there is no level or length here, on purpose. These are documents the
// learner meets in real life — contracts, letters from an office, package
// inserts — and grading them down to A2 would remove the reason for
// photographing them. The stored CEFR level is measured from the result
// afterwards, not imposed on it.
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
    sourceKind?: string;
    note?: string;
    isStudyMaterial?: boolean;
  };

  const sourceText = (body.sourceText ?? "").trim().slice(0, 8000);
  if (!sourceText) {
    return NextResponse.json({ error: "Пустой исходный текст." }, { status: 400 });
  }

  const targetLanguage = (body.targetLanguage ?? "de").trim();
  const nativeLanguage = (body.nativeLanguage ?? "ru").trim();
  const sourceLanguage = (body.sourceLanguage ?? targetLanguage).trim();

  const note = (body.note ?? "").trim().slice(0, 800);

  const prompt = buildDocumentFromSourcePrompt({
    sourceText,
    sourceLanguage,
    targetLanguage,
    nativeLanguage,
    note,
    isStudyMaterial: body.isStudyMaterial === true,
  });

  const result = await runLessonPrompt(apiKey, prompt, { faithful: true });

  // What the learner gets when the rewrite could not be had.
  //
  // The transcription is already in hand and is most of the value — the words
  // that were on the page. Handing it over beats an error message that throws
  // the reading away, so the only failures that reach the learner as failures
  // are the ones where there is nothing to hand over: a refusal, or a photo
  // that could not be read in the first place. The lesson says plainly that it
  // is the raw text.
  let lesson = result.ok ? result.lesson : null;
  let degraded = false;
  if (!lesson) {
    const sameLanguage = sourceLanguage === targetLanguage;
    const salvaged = sameLanguage && !note && body.isStudyMaterial !== true
      ? lessonFromTranscription(sourceText, (body.sourceKind ?? "").trim())
      : null;
    if (!salvaged) {
      return NextResponse.json({ error: result.ok ? "Пустой урок." : result.error }, { status: result.ok ? 502 : result.status });
    }
    lesson = salvaged;
    degraded = true;
  }

  // The document is whatever difficulty it is; measure the result rather than
  // pretending the learner chose a level for it.
  const { level, lix } = estimateLevel(lesson.paragraphs.join(" "));

  const saved = await saveGeneratedLesson(supabaseAdmin, {
    userId: user.id,
    lesson,
    level,
    targetLanguage,
    nativeLanguage,
    extraMetadata: {
      origin: "photo",
      source_language: sourceLanguage,
      source_kind: (body.sourceKind ?? "").trim().slice(0, 120),
      translated: sourceLanguage !== targetLanguage,
      note,
      study_material: body.isStudyMaterial === true,
      // Measured from the text, not chosen — the catalogue marks it with "≈".
      level_estimated: true,
      // The rewrite failed and this is the raw transcription.
      raw_transcription: degraded,
      // The model's answer was cut short and had to be salvaged.
      truncated: result.ok ? result.truncated : false,
      lix,
      // The transcription, so a later revision can be checked against what was
      // actually on the page. The photo itself is never stored.
      source_text: sourceText.slice(0, 6000),
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
    // The client warns rather than silently passing off a degraded or
    // shortened result as the finished thing.
    warning: degraded
      ? "Разбор не удался — сохранён текст со снимка как есть."
      : result.ok && result.truncated
        ? "Текст мог обрезаться в конце: снимите длинную страницу по частям."
        : undefined,
  });
}
