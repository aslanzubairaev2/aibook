import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runDictionaryPrompt } from "@/lib/ai/lessonModel";
import { buildDictionaryFromImagePrompt, parseDictionaryEntries } from "@/lib/ai/buildDictionaryPrompt";
import {
  createCardsForEntries,
  dedupeDictionaryDrafts,
  discardDictionaryBatch,
  saveDictionaryEntries,
} from "@/lib/db/dictionaryStore";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A name the learner will recognise in a list a month from now. */
function batchTitle(pageKind: string, topic: string): string {
  const date = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
  if (topic) return `${topic} · ${date}`;
  if (pageKind) return `${pageKind.charAt(0).toUpperCase()}${pageKind.slice(1)} · ${date}`;
  return `Слова · ${date}`;
}

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

  const {
    entries: parsedEntries,
    pageKind,
    topic,
    pageLabel,
    isVocabularyList,
  } = parseDictionaryEntries(result.data);
  const entries = dedupeDictionaryDrafts(parsedEntries);
  if (entries.length === 0) {
    return NextResponse.json(
      { error: "На снимке не нашлось слов. Попробуйте кадр покрупнее или при лучшем свете." },
      { status: 422 },
    );
  }

  // One photo, one batch: the page is the unit the learner was set to learn,
  // and keeping it whole is the whole point of the dictionary being organised.
  const title = batchTitle(pageKind, topic);
  // The page label ("стр. 56", "Lektion 4") travels inside `kind`, which the
  // batch header prints — no extra column needed.
  const kindLine = [pageKind, pageLabel].filter(Boolean).join(" · ");
  const { data: batch, error: batchError } = await supabaseAdmin
    .from("dictionary_batches")
    .insert({
      user_id: user.id,
      title,
      kind: kindLine,
      topic,
      language: targetLanguage,
      word_count: entries.length,
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return NextResponse.json(
      { error: `Не удалось создать пачку слов: ${batchError?.message ?? "нет ответа"}` },
      { status: 500 },
    );
  }

  const saved = await saveDictionaryEntries(
    supabaseAdmin,
    user.id,
    targetLanguage,
    entries,
    pageKind ? `Фото · ${pageKind}` : "Фото",
    batch.id as string,
  );
  if (!saved.ok) {
    const cleanupError = await discardDictionaryBatch(supabaseAdmin, user.id, batch.id as string);
    const suffix = cleanupError ? `; не удалось убрать пустую пачку: ${cleanupError}` : "";
    return NextResponse.json({ error: `${saved.error}${suffix}` }, { status: 500 });
  }

  const cards = await createCardsForEntries(supabaseAdmin, user.id, entries, batch.id as string, title);
  if (!cards.ok) {
    const cleanupError = await discardDictionaryBatch(supabaseAdmin, user.id, batch.id as string);
    const suffix = cleanupError ? `; не удалось убрать неполную пачку: ${cleanupError}` : "";
    return NextResponse.json({ error: `${cards.error}${suffix}` }, { status: 500 });
  }

  return NextResponse.json({
    batchId: batch.id,
    batchTitle: title,
    added: saved.added,
    updated: saved.updated,
    cardsCreated: cards.created,
    total: entries.length,
    pageKind,
    topic,
    isVocabularyList,
    // A truncated answer means the tail of a long page did not arrive; the
    // learner should know to photograph the rest rather than assume it is in.
    warning: result.truncated
      ? "Страница длинная — часть слов могла не поместиться. Сфотографируйте нижнюю половину отдельно."
      : undefined,
  });
}
