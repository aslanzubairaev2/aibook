import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runHomeworkPrompt } from "@/lib/ai/lessonModel";
import { buildHomeworkExtractPrompt, parseHomeworkLesson } from "@/lib/ai/buildHomeworkPrompt";
import { saveHomeworkLesson } from "@/lib/db/homeworkStore";

export const dynamic = "force-dynamic";
// Same ceiling as /api/lessons/from-image: a dense page routinely takes longer
// than the 10s default, which the platform would otherwise kill mid-call.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// POST /api/lessons/from-homework-image
// Body: { image: "data:image/jpeg;base64,…", homeworkDate: "YYYY-MM-DD", targetLanguage, nativeLanguage, note? }
//
// One call, straight from the photo to a saved exercise set — unlike the
// document flow this never rewrites or translates the page, so there is no
// language-choice step in between and nothing to retry from a cached
// transcription: a failure here means re-reading the photo.
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
    image?: string;
    homeworkDate?: string;
    targetLanguage?: string;
    nativeLanguage?: string;
    note?: string;
  };

  const homeworkDate = (body.homeworkDate ?? "").trim();
  if (!DATE_RE.test(homeworkDate)) {
    return NextResponse.json({ error: "Укажите дату домашнего задания." }, { status: 400 });
  }

  const dataUrl = (body.image ?? "").trim();
  const match = dataUrl.match(/^data:([a-z/+.-]+);base64,(.+)$/i);
  if (!match) {
    return NextResponse.json({ error: "Некорректное изображение." }, { status: 400 });
  }

  const [, mimeType, base64] = match;
  if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
    return NextResponse.json({ error: "Поддерживаются JPEG, PNG и WebP." }, { status: 400 });
  }
  if ((base64.length * 3) / 4 > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Снимок слишком большой. Обрежьте кадр плотнее." }, { status: 413 });
  }

  const targetLanguage = (body.targetLanguage ?? "de").trim();
  const nativeLanguage = (body.nativeLanguage ?? "ru").trim();

  const result = await runHomeworkPrompt(apiKey, buildHomeworkExtractPrompt(), base64, mimeType.toLowerCase());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const lesson = parseHomeworkLesson(result.data);
  if (!lesson) {
    return NextResponse.json(
      { error: "На снимке не удалось разобрать упражнения. Попробуйте кадр покрупнее или при лучшем свете." },
      { status: 422 },
    );
  }

  const saved = await saveHomeworkLesson(supabaseAdmin, {
    userId: user.id,
    lesson,
    targetLanguage,
    nativeLanguage,
    homeworkDate,
    extraMetadata: {
      note: (body.note ?? "").trim().slice(0, 800),
      truncated: result.truncated,
    },
  });

  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    id: saved.id,
    title: lesson.title,
    description: lesson.description,
    exerciseCount: lesson.exercises.length,
    warning: result.truncated
      ? "Часть страницы могла обрезаться: снимите длинную страницу по частям."
      : undefined,
  });
}
