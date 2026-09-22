import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { runHomeworkPrompt } from "@/lib/ai/lessonModel";
import { buildHomeworkExtractPrompt, parseHomeworkLesson, type HomeworkLesson } from "@/lib/ai/buildHomeworkPrompt";
import { saveHomeworkLesson } from "@/lib/db/homeworkStore";
import { readBatches, type DictionaryBatch } from "@/lib/db/dictionaryStore";
import { extractPageLabel } from "@/lib/lessonMetadata";

export const dynamic = "force-dynamic";
// Same ceiling as /api/lessons/from-image: a dense page routinely takes longer
// than the 10s default, which the platform would otherwise kill mid-call.
export const maxDuration = 60;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE_REFERENCE_RE = /(?:seite|s\.|с\.|стр\.?|страниц(?:а|е)?|page)\s*[:.]?\s*(\d+(?:\s*[-–]\s*\d+)?)/giu;

type ReferencePack = {
  id: string;
  title: string;
  kind?: string;
  description?: string;
  words: string[];
  verbs: string[];
};

type ReferenceEntry = {
  batch_id: string | null;
  headword: string | null;
  lemma: string | null;
  part_of_speech: string | null;
};

function uniqueWords(values: Array<string | null | undefined>, limit = 180): string[] {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, limit);
}

function makeReferencePacks(batches: DictionaryBatch[], entries: ReferenceEntry[]): ReferencePack[] {
  const byBatch = new Map<string, ReferenceEntry[]>();
  for (const entry of entries) {
    if (!entry.batch_id) continue;
    const list = byBatch.get(entry.batch_id) ?? [];
    list.push(entry);
    byBatch.set(entry.batch_id, list);
  }

  return batches
    .map((batch) => {
      const batchEntries = byBatch.get(batch.id) ?? [];
      const words = uniqueWords(batchEntries.flatMap((entry) => [entry.headword, entry.lemma]));
      const verbs = uniqueWords(batchEntries
        .filter((entry) => /(verb|глагол)/iu.test(entry.part_of_speech ?? ""))
        .flatMap((entry) => [entry.headword, entry.lemma]));
      return {
        id: batch.id,
        title: batch.title,
        kind: batch.kind,
        description: batch.description,
        words,
        verbs,
      };
    })
    .filter((pack) => pack.words.length > 0);
}

function homeworkReferenceText(lesson: HomeworkLesson): string {
  return [
    lesson.title,
    lesson.description,
    lesson.sourceKind,
    ...lesson.exercises.flatMap((exercise) => [
      exercise.instruction,
      ...(exercise.items ?? []).map((item) => item.text),
    ]),
  ].join(" ");
}

function findReferencePack(lesson: HomeworkLesson, packs: ReferencePack[], requestedId: string): ReferencePack | null {
  if (requestedId) return packs.find((pack) => pack.id === requestedId) ?? null;
  if (lesson.referenceBatchId) {
    const modelPack = packs.find((pack) => pack.id === lesson.referenceBatchId);
    if (modelPack) return modelPack;
  }

  const text = homeworkReferenceText(lesson);
  const pages = [...text.matchAll(PAGE_REFERENCE_RE)].map((match) => match[1].replace(/\s+/g, ""));
  for (const page of pages) {
    const pagePack = packs.find((pack) => extractPageLabel(pack.kind, pack.description, pack.title) === page);
    if (pagePack) return pagePack;
  }

  const lowerText = text.toLocaleLowerCase();
  const scored = packs.map((pack) => ({
    pack,
    score: pack.words.reduce((score, word) => {
      const candidate = word.toLocaleLowerCase();
      return candidate.length >= 4 && lowerText.includes(candidate) ? score + 1 : score;
    }, 0),
  })).sort((a, b) => b.score - a.score);
  return scored[0]?.score >= 2 ? scored[0].pack : null;
}

function applyReferenceBank(lesson: HomeworkLesson, pack: ReferencePack | null, force: boolean): HomeworkLesson {
  if (!pack) return lesson;
  const exercises = lesson.exercises.map((exercise) => {
    const exerciseText = `${exercise.instruction} ${(exercise.items ?? []).map((item) => item.text).join(" ")}`;
    const mentionsVocabulary = force || /(wortschatz|vokabular|dictionary|словар|лексик)/iu.test(exerciseText);
    if (!mentionsVocabulary && exercise.widget !== "sort") return exercise;
    const isVerbExercise = /(verben|глагол|verbs)/iu.test(exercise.instruction)
      && !/(pronomen|местоимени|personal)/iu.test(exercise.instruction);
    const bank = isVerbExercise && pack.verbs.length > 0 ? pack.verbs : pack.words;
    return (exercise.bank?.length ?? 0) > 0 || !bank.length
      ? exercise
      : { ...exercise, bank };
  });
  return { ...lesson, referenceBatchId: pack.id, exercises };
}

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
    referenceBatchId?: string;
    titleSuffix?: string;
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

  const requestedReferenceBatchId = (body.referenceBatchId ?? "").trim();
  let referencePacks: ReferencePack[] = [];
  let selectedReferencePack: ReferencePack | null = null;
  if (requestedReferenceBatchId) {
    const { batches, error: batchesError } = await readBatches(supabaseAdmin, user.id, { language: targetLanguage });
    if (batchesError) {
      return NextResponse.json({ error: "Не удалось прочитать словарь для ссылки на упражнение." }, { status: 500 });
    }
    const requestedBatch = batches.find((batch) => batch.id === requestedReferenceBatchId);
    if (!requestedBatch) {
      return NextResponse.json({ error: "Выбранная пачка слов не найдена." }, { status: 400 });
    }
    const { data: words, error: wordsError } = await supabaseAdmin
      .from("dictionary_entries")
      .select("batch_id, headword, lemma, part_of_speech")
      .eq("user_id", user.id)
      .eq("batch_id", requestedBatch.id)
      .limit(2400);
    if (wordsError) {
      return NextResponse.json({ error: "Не удалось прочитать выбранную пачку слов." }, { status: 500 });
    }
    referencePacks = makeReferencePacks([requestedBatch], (words ?? []) as ReferenceEntry[]);
    selectedReferencePack = referencePacks.find((pack) => pack.id === requestedBatch.id) ?? null;
  }
  const referenceTitle = selectedReferencePack?.title ?? "";
  const referenceWords = selectedReferencePack?.words ?? [];

  const result = await runHomeworkPrompt(
    apiKey,
    buildHomeworkExtractPrompt({
      referenceTitle,
      referenceWords,
    }),
    base64,
    mimeType.toLowerCase(),
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const parsedLesson = parseHomeworkLesson(result.data);
  if (!parsedLesson) {
    return NextResponse.json(
      { error: "На снимке не удалось разобрать упражнения. Попробуйте кадр покрупнее или при лучшем свете." },
      { status: 422 },
    );
  }

  // Automatic lookup happens only after the photo has parsed successfully.
  // Apart from avoiding needless database work on bad photos, this means the
  // photographed instruction itself decides whether a dictionary is needed.
  const needsAutomaticReference = /(wortschatz|vokabular|dictionary|словар|лексик)/iu.test(homeworkReferenceText(parsedLesson));
  if (!requestedReferenceBatchId && needsAutomaticReference) {
    const { batches } = await readBatches(supabaseAdmin, user.id, { language: targetLanguage });
    const candidateBatches = batches.slice(0, 40);
    const candidateIds = candidateBatches.map((batch) => batch.id);
    if (candidateIds.length > 0) {
      const { data: words } = await supabaseAdmin
        .from("dictionary_entries")
        .select("batch_id, headword, lemma, part_of_speech")
        .eq("user_id", user.id)
        .in("batch_id", candidateIds)
        .limit(2400);
      referencePacks = makeReferencePacks(candidateBatches, (words ?? []) as ReferenceEntry[]);
    }
  }

  const resolvedReferencePack = findReferencePack(parsedLesson, referencePacks, requestedReferenceBatchId);
  const lesson = applyReferenceBank(parsedLesson, resolvedReferencePack, Boolean(requestedReferenceBatchId));

  const saved = await saveHomeworkLesson(supabaseAdmin, {
    userId: user.id,
    lesson,
    targetLanguage,
    nativeLanguage,
    homeworkDate,
    extraMetadata: {
      note: (body.note ?? "").trim().slice(0, 800),
      reference_batch_id: resolvedReferencePack?.id || undefined,
      reference_batch_title: resolvedReferencePack?.title || undefined,
      reference_words_count: resolvedReferencePack?.words.length || undefined,
      truncated: result.truncated,
    },
    titleSuffix: (body.titleSuffix ?? "").trim(),
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
