import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runDictionaryPrompt } from "@/lib/ai/lessonModel";
import { buildDictionaryFromImagePrompt, parseDictionaryEntries } from "@/lib/ai/buildDictionaryPrompt";
import { saveDictionaryEntries } from "@/lib/db/dictionaryStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

// POST /api/dictionary/from-image
// Body: { image: "data:image/jpeg;base64,…", targetLanguage, nativeLanguage, note? }
//
// Turns a photographed page into dictionary entries — one row per word. A
// coursebook word list yields exactly the words printed on it; any other page
// yields the words worth looking up from that page.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы пополнять словарь." }, { status: 401 });
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
    targetLanguage?: string;
    nativeLanguage?: string;
    note?: string;
  };

  const match = (body.image ?? "").trim().match(/^data:([a-z/+.-]+);base64,(.+)$/i);
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
  const note = (body.note ?? "").trim().slice(0, 500);

  const prompt = buildDictionaryFromImagePrompt({ targetLanguage, nativeLanguage, note });
  const result = await runDictionaryPrompt(apiKey, prompt, base64, mimeType.toLowerCase());
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const { entries, pageKind, isVocabularyList } = parseDictionaryEntries(result.data);
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "На снимке не нашлось слов. Попробуйте кадр покрупнее или при лучшем свете." },
      { status: 422 },
    );
  }

  const saved = await saveDictionaryEntries(
    supabaseAdmin,
    user.id,
    targetLanguage,
    entries,
    pageKind ? `Фото · ${pageKind}` : "Фото",
  );
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  return NextResponse.json({
    added: saved.added,
    updated: saved.updated,
    total: entries.length,
    pageKind,
    isVocabularyList,
    // A truncated answer means the tail of a long page did not arrive; the
    // learner should know to photograph the rest rather than assume it is in.
    warning: result.truncated
      ? "Страница длинная — часть слов могла не поместиться. Сфотографируйте нижнюю половину отдельно."
      : undefined,
  });
}
