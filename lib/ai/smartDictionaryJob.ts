import { runSmartDictionaryPrompt } from "@/lib/ai/smartDictionary";
import type { DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";
import { germanVerbContractText, validateGermanVerbEntries } from "@/lib/ai/verbEntryValidation";
import { getLazySupabaseAdmin } from "@/lib/db/supabase-admin-lazy";
import {
  createCardsForEntries,
  dedupeDictionaryDrafts,
  findOrCreatePack,
  saveDictionaryEntries,
} from "@/lib/db/dictionaryStore";

export const MAX_AGENT_ROUNDS = 40;

export type SmartDictionaryJobRecord = {
  id: string;
  user_id: string;
  mode: "single" | "topic";
  request: string;
  input_language: string;
  target_language: string;
  native_language: string;
  batch_id: string | null;
  batch_title: string;
  workflow_run_id: string | null;
  status: "queued" | "running" | "waiting_input" | "completed" | "failed";
  current_action: string;
  rounds_completed: number;
  total_added: number;
  last_words: string[];
  clarification: string | null;
  hook_token: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
};

type SmartModelPayload = {
  title?: string;
  topic?: string;
  description?: string;
  clarification?: string;
  done?: boolean;
  entries?: unknown;
};

export type SmartRoundResult =
  | { status: "continue"; round: number }
  | { status: "waiting_input"; round: number; clarification: string }
  | { status: "completed"; round: number; result: Record<string, unknown> }
  | { status: "failed"; round: number; error: string };

export function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

function payloadOf(value: unknown): SmartModelPayload {
  return (typeof value === "object" && value !== null ? value : {}) as SmartModelPayload;
}

function normalizeKey(value: string): string {
  return value.trim().toLocaleLowerCase("de-DE").replace(/\s+/g, " ");
}

export function makeSmartDictionaryPrompt(params: {
  mode: "single" | "topic";
  request: string;
  target: string;
  native: string;
  inputLanguage: string;
  known: string[];
  round: number;
  batchTitle?: string;
  clarificationQuestion?: string;
  clarificationAnswer?: string;
}): string {
  const { mode, request, target, native, inputLanguage, known, round, batchTitle, clarificationQuestion, clarificationAnswer } = params;
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
    : `Build an exhaustive themed vocabulary set, not a short sample. This is continuation round ${round} of up to ${MAX_AGENT_ROUNDS}.
Return 25–45 new items in this round. Keep going until every item the request reasonably means is covered. For requests such as all colours, seasons, or A1 irregular verbs, do not stop at a few examples. Return done=true only when the set is complete; otherwise return done=false so the agent can continue.`}

${knownBlock}

For every item return:
- headword: dictionary form in ${target}; nouns include their definite article
- lemma: bare base form without article
- translation: concise translation into ${native}
- partOfSpeech: in ${native} (существительное, глагол, прилагательное, наречие, выражение, etc.)
- contentType: exactly word, phrase, sentence, or expression
- noun gender/article/plural only for nouns, otherwise empty strings
- forms: always return the complete object required by the schema; for German verbs obey the contract below, for other items use empty strings where a field does not apply
- cefr: A1, A2, B1, B2, C1, or C2
- note: one short learner warning when useful
- example and exampleTranslation: one natural short example
${germanVerbContractText(target)}

Use reliable linguistic knowledge. Do not invent a word merely to reach a count. If the request names a song, author, or other work without enough detail to identify it, ask which exact work in clarification before generating.
Return only JSON with title, topic, description, clarification, done, and entries. ${isSingle ? "Set done=true." : ""}`;
}

export function parseSmartEntries(payload: SmartModelPayload, targetLanguage: string): { entries: DictionaryEntryDraft[]; invalidVerbs: string[] } {
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
  const checked = validateGermanVerbEntries(entries, targetLanguage);
  return {
    entries: dedupeDictionaryDrafts(checked.entries).filter((entry) => entry.headword && entry.lemma && entry.translation),
    invalidVerbs: checked.invalidVerbs,
  };
}

export async function readSmartDictionaryJob(jobId: string): Promise<SmartDictionaryJobRecord | null> {
  const admin = getLazySupabaseAdmin();
  if (!admin) return null;
  const { data } = await admin.from("dictionary_generation_jobs").select("*").eq("id", jobId).maybeSingle();
  return (data as SmartDictionaryJobRecord | null) ?? null;
}

export async function updateSmartDictionaryJob(jobId: string, patch: Record<string, unknown>) {
  const admin = getLazySupabaseAdmin();
  if (!admin) return;
  await admin.from("dictionary_generation_jobs").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", jobId);
}

async function readBatchWords(job: SmartDictionaryJobRecord): Promise<string[]> {
  const admin = getLazySupabaseAdmin();
  if (!admin || !job.batch_id) return [];
  const { data } = await admin
    .from("dictionary_entries")
    .select("headword, lemma")
    .eq("user_id", job.user_id)
    .eq("batch_id", job.batch_id)
    .eq("language", job.target_language)
    .limit(2000);
  return Array.from(new Set((data ?? [])
    .flatMap((entry) => [entry.lemma, entry.headword])
    .map((word) => clean(word, 200))
    .filter(Boolean))).slice(0, 1200);
}

async function readBatchContext(job: SmartDictionaryJobRecord): Promise<{ title: string; words: string[] } | null> {
  const admin = getLazySupabaseAdmin();
  if (!admin || !job.batch_id) return { title: job.batch_title, words: [] };
  const { data: batch } = await admin
    .from("dictionary_batches")
    .select("id, title, language")
    .eq("id", job.batch_id)
    .eq("user_id", job.user_id)
    .maybeSingle();
  if (!batch || (batch.language && batch.language !== job.target_language)) return null;
  return { title: clean(batch.title, 180), words: await readBatchWords(job) };
}

async function saveBatchWordCount(batchId: string, userId: string, count: number) {
  await getLazySupabaseAdmin()?.from("dictionary_batches").update({ word_count: count }).eq("id", batchId).eq("user_id", userId);
}

async function failJob(jobId: string, round: number, error: string): Promise<SmartRoundResult> {
  await updateSmartDictionaryJob(jobId, { status: "failed", current_action: "Не удалось завершить сбор слов", error, clarification: null, hook_token: null });
  return { status: "failed", round, error };
}

export async function runSmartDictionaryRound(
  jobId: string,
  apiKey: string,
  clarificationQuestion = "",
  clarificationAnswer = "",
  hookToken = "",
): Promise<SmartRoundResult> {
  "use step";
  const job = await readSmartDictionaryJob(jobId);
  if (!job) return { status: "failed", round: 0, error: "Задача добавления не найдена." };
  const admin = getLazySupabaseAdmin();
  if (!admin) return failJob(jobId, job.rounds_completed, "Supabase не настроен на сервере.");

  const round = job.rounds_completed + 1;
  if (round > MAX_AGENT_ROUNDS) return failJob(jobId, job.rounds_completed, "Сбор остановлен после безопасного лимита раундов. Запустите запрос ещё раз, чтобы продолжить пачку.");
  await updateSmartDictionaryJob(jobId, {
    status: "running",
    current_action: `ИИ проверяет запрос и собирает раунд ${round}${job.mode === "topic" ? ` из ${MAX_AGENT_ROUNDS}` : ""}…`,
    clarification: null,
    hook_token: null,
    error: null,
  });

  const batchContext = await readBatchContext(job);
  if (!batchContext) return failJob(jobId, round, "Выбранная пачка не найдена или относится к другому языку.");
  const known = batchContext.words;
  const batchTitleFromDb = batchContext.title || job.batch_title;
  if (batchTitleFromDb !== job.batch_title) {
    await updateSmartDictionaryJob(jobId, { batch_title: batchTitleFromDb });
  }
  const result = await runSmartDictionaryPrompt(
    apiKey,
    makeSmartDictionaryPrompt({
      mode: job.mode,
      request: job.request,
      target: job.target_language,
      native: job.native_language,
      inputLanguage: job.input_language,
      known,
      round,
      batchTitle: batchTitleFromDb || undefined,
      clarificationQuestion: clarificationQuestion || undefined,
      clarificationAnswer: clarificationAnswer || undefined,
    }),
    job.mode === "single" ? 5000 : 16000,
  );
  if (!result.ok) {
    if (result.status >= 500 || result.status === 429) throw new Error(result.error);
    return failJob(jobId, round, result.error);
  }

  let modelMeta = payloadOf(result.value);
  let parsed = parseSmartEntries(modelMeta, job.target_language);
  const clarification = clean(modelMeta.clarification, 500);
  if (clarification && parsed.entries.length === 0) {
    await updateSmartDictionaryJob(jobId, {
      status: "waiting_input",
      current_action: "Жду уточнение от вас",
      clarification,
      hook_token: hookToken,
    });
    return { status: "waiting_input", round: job.rounds_completed, clarification };
  }

  if (parsed.invalidVerbs.length > 0) {
    await updateSmartDictionaryJob(jobId, { current_action: "Проверяю и исправляю формы глаголов…" });
    const repair = await runSmartDictionaryPrompt(
      apiKey,
      `${makeSmartDictionaryPrompt({
        mode: job.mode,
        request: job.request,
        target: job.target_language,
        native: job.native_language,
        inputLanguage: job.input_language,
        known,
        round,
        batchTitle: batchTitleFromDb || undefined,
        clarificationQuestion: clarificationQuestion || undefined,
        clarificationAnswer: clarificationAnswer || undefined,
      })}

The previous candidate was rejected by the machine validator because these German verbs were incomplete: ${parsed.invalidVerbs.join("; ")}.
Return the complete requested set again. Do not omit any item and do not return clarification unless the verb itself is ambiguous.`,
      job.mode === "single" ? 5000 : 16000,
    );
    if (!repair.ok) {
      if (repair.status >= 500 || repair.status === 429) throw new Error(repair.error);
      return failJob(jobId, round, repair.error);
    }
    modelMeta = payloadOf(repair.value);
    parsed = parseSmartEntries(modelMeta, job.target_language);
  }
  if (parsed.invalidVerbs.length > 0) {
    return failJob(jobId, round, `ИИ вернул неполные формы глагола: ${parsed.invalidVerbs.slice(0, 3).join("; ")}. Пачка не сохранена.`);
  }

  const knownKeys = new Set(known.map(normalizeKey));
  const entries = parsed.entries.filter((entry) => {
    const keys = [entry.lemma, entry.headword].map(normalizeKey).filter(Boolean);
    return keys.every((key) => !knownKeys.has(key));
  });
  if (entries.length === 0) return failJob(jobId, round, "ИИ не вернул новых слов. Попробуйте уточнить запрос.");

  let batchId = job.batch_id;
  let batchTitle = batchTitleFromDb;
  if (!batchId) {
    const date = new Date();
    const stamp = `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    batchTitle = job.mode === "single"
      ? `Слово · ${entries[0].headword} · ${stamp}`
      : clean(modelMeta.title, 180) || `ИИ · ${clean(modelMeta.topic, 100) || "новая тема"} · ${stamp}`;
    const pack = await findOrCreatePack(admin, job.user_id, {
      title: batchTitle,
      kind: "от ИИ",
      topic: clean(modelMeta.topic, 80),
      language: job.target_language,
      description: clean(modelMeta.description, 1000) || `${entries.length} слов по запросу «${job.request}»`,
      instruction: job.request,
    });
    if (!pack.ok) return failJob(jobId, round, pack.error);
    batchId = pack.id;
    await updateSmartDictionaryJob(jobId, { batch_id: batchId, batch_title: batchTitle });
  }

  await updateSmartDictionaryJob(jobId, {
    current_action: `Сохраняю ${entries.length} новых слов в пачку…`,
    last_words: entries.map((entry) => entry.headword).slice(0, 60),
  });
  const saved = await saveDictionaryEntries(admin, job.user_id, job.target_language, entries, `ИИ · ${job.request}`, batchId);
  if (!saved.ok) return failJob(jobId, round, saved.error);
  const cards = await createCardsForEntries(admin, job.user_id, entries, batchId, batchTitle);
  if (!cards.ok) return failJob(jobId, round, cards.error);

  const { count } = await admin.from("dictionary_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", job.user_id)
    .eq("batch_id", batchId);
  await saveBatchWordCount(batchId, job.user_id, count ?? entries.length);

  const done = job.mode === "single" || modelMeta.done === true;
  const roundsCompleted = job.rounds_completed + 1;
  const resultPayload = {
    batchId,
    batchTitle,
    added: saved.added,
    updated: saved.updated,
    cardsCreated: cards.created,
    total: entries.length,
    rounds: roundsCompleted,
    complete: done,
    warning: !done ? "Пачка ещё собирается в фоне." : undefined,
  };
  await updateSmartDictionaryJob(jobId, {
    status: done ? "completed" : "running",
    current_action: done ? "Пачка готова" : `Раунд ${roundsCompleted} сохранён, продолжаю сбор…`,
    rounds_completed: roundsCompleted,
    total_added: count ?? entries.length,
    last_words: entries.map((entry) => entry.headword).slice(0, 60),
    result: resultPayload,
    completed_at: done ? new Date().toISOString() : null,
  });
  return done ? { status: "completed", round: roundsCompleted, result: resultPayload } : { status: "continue", round: roundsCompleted };
}

export async function markSmartDictionaryJobFailed(jobId: string, error: string) {
  "use step";
  await updateSmartDictionaryJob(jobId, { status: "failed", current_action: "Задача остановлена", error: error.slice(0, 1000) });
}
