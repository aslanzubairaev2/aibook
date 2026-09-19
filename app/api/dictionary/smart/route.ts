import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { runSmartDictionaryPrompt } from "@/lib/ai/smartDictionary";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import {
  createCardsForEntries,
  dedupeDictionaryDrafts,
  findOrCreatePack,
  saveDictionaryEntries,
} from "@/lib/db/dictionaryStore";
import type { DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type SmartRequest = {
  mode?: "single" | "topic";
  request?: string;
  inputLanguage?: "auto" | "target" | "native";
  targetLanguage?: string;
  nativeLanguage?: string;
  batchId?: string | null;
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
const MAX_AGENT_ROUNDS = 12;

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
  round: number;
}): string {
  const { mode, request, target, native, inputLanguage, known, round } = params;
  const isSingle = mode === "single";
  const knownBlock = known.length > 0
    ? `Already collected — never repeat these lemmas or headwords:\n${known.join("\n")}`
    : "No words have been collected yet.";

  return `You are the vocabulary research agent inside a language-learning app.
The learner studies ${target}; their native language is ${native}.
The learner's request is: "${request}"
The input language hint is ${inputLanguage}. Detect the actual language yourself; never use browser speech recognition.

${isSingle
    ? "Return exactly one learning item matching the request. If it is ambiguous, return no entries and put one concise clarification question in clarification."
    : `Build an exhaustive themed vocabulary set, not a short sample. This is continuation round ${round} of up to ${MAX_AGENT_ROUNDS}.
Return 25–45 new items in this round. Keep going until every item the request reasonably means is covered. For requests such as all colours, seasons, or A1 irregular verbs, do not stop at a few examples. Return done=true only when the set is complete; otherwise return done=false so the agent can continue.`}

${knownBlock}

For every item return:
- headword: dictionary form in ${target}; nouns include their definite article
- lemma: bare base form without article
- translation: concise translation into ${native}
- partOfSpeech: in ${native} (существительное, глагол, прилагательное, наречие, выражение, etc.)
- contentType: exactly word, phrase, sentence, or expression
- noun gender/article/plural only for nouns; otherwise empty strings
- forms for irregular verbs or irregular adjective comparison where relevant
- cefr: A1, A2, B1, B2, C1, or C2
- note: one short learner warning when useful
- example and exampleTranslation: one natural short example

Use reliable linguistic knowledge. Do not invent a word merely to reach a count. If the request names a song, author, or other work without enough detail to identify it, ask which exact work in clarification before generating.
Return only JSON with title, topic, description, clarification, done, and entries. ${isSingle ? "Set done=true." : ""}`;
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
  if (!request) return NextResponse.json({ error: "Напишите слово или тему." }, { status: 400 });

  let batchId = clean(body.batchId, 80) || null;
  let batchTitle = "";
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
  }

  const allEntries: DictionaryEntryDraft[] = [];
  let modelMeta: SmartModelPayload = {};
  let repaired = false;
  let done = mode === "single";

  for (let round = 1; round <= (mode === "single" ? 1 : MAX_AGENT_ROUNDS); round++) {
    const known = allEntries.flatMap((entry) => [entry.lemma, entry.headword]);
    const result = await runSmartDictionaryPrompt(
      apiKey,
      makePrompt({ mode, request, target, native, inputLanguage, known, round }),
      mode === "single" ? 5000 : 14000,
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    repaired ||= result.repaired;
    modelMeta = payloadOf(result.value);
    const clarification = clean(modelMeta.clarification, 500);
    if (clarification && allEntries.length === 0) {
      return NextResponse.json({ clarification, rounds: round });
    }

    allEntries.push(...parseEntries(modelMeta));
    const unique = dedupeDictionaryDrafts(allEntries);
    allEntries.splice(0, allEntries.length, ...unique);
    done = mode === "single" || modelMeta.done === true;
    if (done) break;
  }

  const entries = allEntries.slice(0, mode === "single" ? 1 : 600);
  if (entries.length === 0) {
    return NextResponse.json({ error: "ИИ не нашёл подходящих слов. Уточните запрос и попробуйте ещё раз." }, { status: 422 });
  }

  if (!batchId) {
    const date = new Date();
    const stamp = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    batchTitle = mode === "single"
      ? `Слово · ${entries[0].headword} · ${stamp}`
      : clean(modelMeta.title, 180) || `ИИ · ${clean(modelMeta.topic, 100) || "новая тема"} · ${stamp}`;
    const pack = await findOrCreatePack(supabaseAdmin, user.id, {
      title: batchTitle,
      kind: "от ИИ",
      topic: clean(modelMeta.topic, 80),
      language: target,
      description: clean(modelMeta.description, 1000) || `${entries.length} слов по запросу «${request}»`,
      instruction: request,
    });
    if (!pack.ok) return NextResponse.json({ error: pack.error }, { status: 500 });
    batchId = pack.id;
  }

  const saved = await saveDictionaryEntries(supabaseAdmin, user.id, target, entries, `ИИ · ${request}`, batchId);
  if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: 500 });
  const cards = await createCardsForEntries(supabaseAdmin, user.id, entries, batchId, batchTitle);
  if (!cards.ok) return NextResponse.json({ error: cards.error }, { status: 500 });

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
    cardsCreated: cards.created,
    total: entries.length,
    rounds: mode === "single" ? 1 : Math.min(MAX_AGENT_ROUNDS, Math.ceil(entries.length / 30)),
    complete: done,
    warning: !done || repaired ? "ИИ дошёл до лимита раундов. Запустите добавление ещё раз, чтобы продолжить пачку." : undefined,
  });
}
