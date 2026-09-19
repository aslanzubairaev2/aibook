import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { runSmartDictionaryPrompt, smartDictionaryClarification } from "@/lib/ai/smartDictionary";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import {
  createCardsForEntries,
  dedupeDictionaryDrafts,
  findOrCreatePack,
  saveDictionaryEntries,
} from "@/lib/db/dictionaryStore";
import type { DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";
import { validateGermanVerbEntries } from "@/lib/ai/verbEntryValidation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SmartRequest = {
  mode?: "single" | "topic";
  request?: string;
  inputLanguage?: "auto" | "target" | "native";
  targetLanguage?: string;
  nativeLanguage?: string;
  batchId?: string | null;
  clarificationQuestion?: string | null;
  clarificationAnswer?: string | null;
};

type SmartModelPayload = {
  title?: string;
  topic?: string;
  description?: string;
  clarification?: string;
  done?: boolean;
  entries?: unknown;
};

const MAX_REQUEST_LENGTH = 1200;

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function makePrompt(params: {
  mode: "single" | "topic";
  request: string;
  target: string;
  native: string;
  inputLanguage: string;
  known: string[];
  batchTitle?: string;
  clarificationQuestion?: string;
  clarificationAnswer?: string;
}): string {
  const { mode, request, target, native, inputLanguage, known, batchTitle, clarificationQuestion, clarificationAnswer } = params;
  const isSingle = mode === "single";
  const knownBlock = known.length > 0
    ? `${batchTitle ? "These words are already in the selected pack" : "Already collected words"} — never repeat these lemmas or headwords:\n${known.join("\n")}`
    : "No words have been collected yet.";
  const packBlock = batchTitle
    ? `You are adding new words to the existing pack "${batchTitle}". Preserve its theme and do not duplicate anything already in it.`
    : "Create a new pack when the request is complete.";
  const clarificationBlock = clarificationQuestion && clarificationAnswer
    ? `The learner answered your previous clarification question "${clarificationQuestion}" with: "${clarificationAnswer}". Use this answer as authoritative context, do not ask the same question again, and continue the task.`
    : "";

  return `You are the vocabulary research agent inside a language-learning app.
The learner studies ${target}; their native language is ${native}.
The learner's request is: "${request}"
The input language hint is ${inputLanguage}. Detect the actual language yourself; never use browser speech recognition.
${packBlock}
${clarificationBlock}

${isSingle
    ? "Return exactly one learning item matching the request. If it is ambiguous, return no entries and put one concise clarification question in clarification."
    : "Return one reasonable vocabulary set of at most 40 items in this single response. Do not split the request into rounds and do not continue after this response. For a finite canonical list such as seasons or colours, return only the members of that list, not thousands of related words. Do not invent extra items just to make the list larger."}

${knownBlock}

For every item return:
- headword: dictionary form in ${target}; nouns include their definite article
- lemma: bare base form without article
- translation: concise translation into ${native}
- partOfSpeech: in ${native} (существительное, глагол, прилагательное, наречие, выражение, etc.)
- contentType: exactly word, phrase, sentence, or expression
- noun gender/article/plural only for nouns; otherwise empty strings
- for EVERY German verb, including regular and modal verbs, forms MUST contain praeteritum (3rd person singular), partizip2 (bare participle), hilfsverb (exactly haben or sein), and trennbar (exactly да or нет). Never save an incomplete verb. For non-verbs use empty strings in forms.
- "möchten" is a form of "mögen", not a separate infinitive; "tun" is not a modal verb
- cefr: A1, A2, B1, B2, C1, or C2
- note: one short learner warning when useful
- example and exampleTranslation: one natural short example

Use reliable linguistic knowledge. Do not invent a word merely to reach a count. If the request names a song, author, or other work without enough detail to identify it, ask which exact work in clarification before generating.
Return only JSON with title, topic, description, clarification, done, and entries. When no clarification is needed, set clarification to an empty string, never "None" or "null". When clarification is needed, return an actual question and no entries. ${isSingle ? "Set done=true." : ""}`;
}

function payloadOf(value: unknown): SmartModelPayload {
  return (typeof value === "object" && value !== null ? value : {}) as SmartModelPayload;
}

function parseEntries(payload: SmartModelPayload): DictionaryEntryDraft[] {
  const raw = Array.isArray(payload.entries) ? payload.entries : [];
  const entries: DictionaryEntryDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const forms = typeof row.forms === "object" && row.forms !== null
      ? Object.fromEntries(Object.entries(row.forms as Record<string, unknown>)
        .map(([key, value]) => [key.slice(0, 30), clean(value, 120)])
        .filter(([, value]) => value))
      : {};
    entries.push({
      headword: clean(row.headword, 200),
      lemma: clean(row.lemma, 200),
      translation: clean(row.translation, 400),
      partOfSpeech: clean(row.partOfSpeech, 60),
      contentType: (clean(row.contentType, 20) || "word") as DictionaryEntryDraft["contentType"],
      gender: clean(row.gender, 10),
      article: clean(row.article, 20),
      plural: clean(row.plural, 120),
      forms,
      cefr: clean(row.cefr, 4).toUpperCase(),
      note: clean(row.note, 300),
      example: clean(row.example, 400),
      exampleTranslation: clean(row.exampleTranslation, 400),
    });
  }
  return dedupeDictionaryDrafts(entries).filter((entry) => entry.headword && entry.lemma && entry.translation);
}

async function saveBatchWordCount(batchId: string, userId: string, count: number) {
  await supabaseAdmin?.from("dictionary_batches")
    .update({ word_count: count })
    .eq("id", batchId)
    .eq("user_id", userId);
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Войдите, чтобы менять словарь." }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });

  let apiKey: string;
  try { apiKey = await getApiKeyForRequest(req); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Нет доступа к AI." }, { status: 403 }); }

  const body = await req.json() as SmartRequest;
  const mode = body.mode === "topic" ? "topic" : "single";
  const request = clean(body.request, MAX_REQUEST_LENGTH);
  const target = clean(body.targetLanguage, 40) || "de";
  const native = clean(body.nativeLanguage, 40) || "ru";
  const inputLanguage = clean(body.inputLanguage, 20) || "auto";
  const clarificationQuestion = clean(body.clarificationQuestion, 500);
  const clarificationAnswer = clean(body.clarificationAnswer, 1200);
  if (!request) return NextResponse.json({ error: "Напишите слово или тему." }, { status: 400 });
  if (clarificationQuestion && !clarificationAnswer) return NextResponse.json({ error: "Ответьте на уточнение ИИ." }, { status: 400 });

  let batchId = clean(body.batchId, 80) || null;
  let batchTitle = "";
  let existingBatchWords: string[] = [];
  if (batchId) {
    const { data: batch, error } = await supabaseAdmin
      .from("dictionary_batches")
      .select("id, title, language")
      .eq("id", batchId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error || !batch) return NextResponse.json({ error: "Эта пачка не найдена." }, { status: 404 });
    if (batch.language !== target) return NextResponse.json({ error: "Язык пачки не совпадает с выбранным языком." }, { status: 400 });
    batchTitle = String(batch.title ?? "");
    const { data: batchEntries, error: batchEntriesError } = await supabaseAdmin
      .from("dictionary_entries")
      .select("headword, lemma")
      .eq("user_id", user.id)
      .eq("batch_id", batchId)
      .eq("language", target)
      .limit(1000);
    if (batchEntriesError) return NextResponse.json({ error: "Не удалось прочитать слова из пачки." }, { status: 500 });
    existingBatchWords = Array.from(new Set((batchEntries ?? []).flatMap((entry) => [entry.lemma, entry.headword]).map((word) => clean(word, 200)).filter(Boolean))).slice(0, 800);
  }

  const result = await runSmartDictionaryPrompt(
    apiKey,
    makePrompt({ mode, request, target, native, inputLanguage, known: existingBatchWords, batchTitle: batchTitle || undefined, clarificationQuestion: clarificationQuestion || undefined, clarificationAnswer: clarificationAnswer || undefined }),
    mode === "single" ? 5000 : 9000,
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.repaired) return NextResponse.json({ error: "ИИ вернул обрезанный список. Попробуйте более короткую тему — неполная пачка не сохранена." }, { status: 502 });

  const modelMeta = payloadOf(result.value);
  const parsedEntries = parseEntries(modelMeta).slice(0, mode === "single" ? 1 : 40);
  const checked = validateGermanVerbEntries(parsedEntries, target);
  const entries = dedupeDictionaryDrafts(checked.entries);
  const clarification = smartDictionaryClarification(modelMeta.clarification, entries.length);
  if (clarification) return NextResponse.json({ clarification, rounds: 1 });

  if (checked.invalidVerbs.length > 0) {
    return NextResponse.json({ error: `ИИ не заполнил формы глаголов (${checked.invalidVerbs.slice(0, 3).join("; ")}). Пачка не сохранена; попробуйте уточнить запрос.` }, { status: 422 });
  }

  if (entries.length === 0) {
    return NextResponse.json({ error: "ИИ не нашёл подходящих слов. Уточните запрос и попробуйте ещё раз." }, { status: 422 });
  }

  if (!batchId) {
    const date = new Date();
    const stamp = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
    batchTitle = mode === "single"
      ? `Слово · ${entries[0].headword} · ${stamp}`
      : `${clean(modelMeta.title, 160) || `ИИ · ${clean(modelMeta.topic, 100) || "новая тема"}`} · ${stamp}`;
    const pack = await findOrCreatePack(supabaseAdmin, user.id, {
      title: batchTitle,
      kind: "от ИИ",
      topic: clean(modelMeta.topic, 80),
      language: target,
      description: `${entries.length} слов по запросу «${request}»`.slice(0, 1000),
      instruction: request,
    });
    if (!pack.ok) return NextResponse.json({ error: pack.error }, { status: 500 });
    batchId = pack.id;
  }

  const saved = await saveDictionaryEntries(supabaseAdmin, user.id, target, entries, `ИИ · ${request}`, batchId);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  const cards = await createCardsForEntries(supabaseAdmin, user.id, entries, batchId, batchTitle);
  // The dictionary is already committed. A flashcard failure must not make the
  // learner think the pack vanished and retry the paid generation request.
  if (!cards.ok) console.error("smart dictionary flashcards:", cards.error);

  const { count } = await supabaseAdmin.from("dictionary_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("batch_id", batchId);
  await saveBatchWordCount(batchId, user.id, count ?? entries.length);

  return NextResponse.json({
    batchId,
    batchTitle,
    added: saved.added,
    updated: saved.updated,
    cardsCreated: cards.ok ? cards.created : 0,
    warning: cards.ok ? undefined : "Пачка и слова сохранены, но карточки не созданы. Повторный запрос к ИИ не нужен.",
    total: entries.length,
    rounds: 1,
    complete: true,
  });
}
