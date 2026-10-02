// MCP tools for interactive tests: the teacher agent builds a test, the app
// records its listening passages with its own Gemini key, the learner takes it
// in the app, and the results come back here to be graded and turned into
// review material.
//
// Kept out of tools.ts only for size; tools.ts merges these into the one
// registry, so the capability map and the drift test cover them like any
// other tool.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASSESSMENT_VOICES,
  DIMENSIONS,
  ITEM_TYPES,
  LIMITS,
  RESULTS_RELEASE,
  SKILLS,
  ValidationErrors,
} from "@/lib/assessments/model";
import {
  AssessmentError,
  assessmentResults,
  assessmentStatus,
  createAssessment,
  learningGaps,
  listAssessments,
  prepareAudio,
  publishAssessment,
  submitReview,
  testLink,
  updateAssessment,
} from "@/lib/assessments/store";
import { assessmentTtsModels } from "@/lib/assessments/speech";
import { checkSpeechService, GERMAN_CAPABILITIES, speechConfig } from "@/lib/assessments/azureSpeech";
import type { McpToolDef } from "@/lib/mcp/tools";

export type AssessmentCtx = { admin: SupabaseClient; userId: string; origin: string };
type Args = Record<string, unknown>;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };
const WRITES = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };

/** Errors the agent can act on come back as plain sentences, every problem listed. */
function rethrow(error: unknown): never {
  if (error instanceof ValidationErrors || error instanceof AssessmentError) throw new Error(error.message);
  throw error;
}

async function targetLanguage(ctx: AssessmentCtx): Promise<string> {
  const { data } = await ctx.admin.from("user_settings").select("active_target_lang").eq("user_id", ctx.userId).maybeSingle();
  return (data?.active_target_lang as string) || "de";
}

function requireId(args: Args, key = "assessment_id"): string {
  const id = String(args[key] ?? args.id ?? "").trim();
  if (!id) throw new Error(`Pass '${key}'.`);
  return id;
}

// ─── Capabilities ────────────────────────────────────────────────────────────

const EXAMPLE = {
  client_key: "de-a2-check-2026-10-03",
  title: "Проверка A2: вокзал и выходные",
  description: "Чтение, аудирование, перевод, письмо и говорение по теме «путешествия».",
  mode: "diagnostic",
  language: "de",
  settings: { results_release: "after_review", section_order: "sequential" },
  sections: [
    {
      id: "read",
      title: "Чтение",
      instructions: "Прочитайте объявление и ответьте на вопросы.",
      stimulus: { type: "text", title: "Am Bahnhof", paragraphs: ["Der Zug nach Köln fährt heute von Gleis 7 ab. Er hat 15 Minuten Verspätung."] },
      items: [
        { id: "r1", type: "single_choice", prompt: "Von welchem Gleis fährt der Zug?", options: ["Gleis 5", "Gleis 7", "Gleis 15"], correct: "Gleis 7", focus: "meaning" },
        { id: "r2", type: "gap_text", text: "Der Zug hat {{1}} Minuten Verspätung.", gaps: [{ id: "1", answer: "15", accepted: ["fünfzehn"] }] },
      ],
    },
    {
      id: "listen",
      title: "Аудирование",
      instructions: "Прослушайте диалог (не больше двух раз) и ответьте.",
      stimulus: {
        type: "audio",
        max_plays: 2,
        audio: {
          kind: "dialogue",
          pace: "normal",
          speakers: [{ name: "Anna", voice: "Kore" }, { name: "Ben", voice: "Puck" }],
          lines: [
            { speaker: "Anna", text: "Hallo Ben! Wie war dein Wochenende?" },
            { speaker: "Ben", text: "Super! Ich war mit meinem Bruder am See." },
          ],
        },
      },
      items: [
        { id: "l1", type: "multiple_choice", prompt: "Was stimmt? (несколько вариантов)", options: [{ id: "a", text: "Ben war am See." }, { id: "b", text: "Ben war allein." }, { id: "c", text: "Ben war mit seinem Bruder unterwegs." }], correct: ["a", "c"] },
      ],
    },
    {
      id: "translate",
      title: "Перевод",
      instructions: "Переведите текст на немецкий. Пишите полными предложениями; можно по-разному, главное — смысл и грамматика.",
      items: [
        {
          id: "t1",
          type: "translation",
          source: "В субботу я поехал с другом в Гамбург. Мы долго гуляли по порту. Вечером мы ели рыбу в маленьком ресторане. Было холодно, но очень красиво.",
          points: 10,
          criteria: "Перфект: bin gefahren / sind gelaufen (или haben … gemacht), haben gegessen; предлог mit + Dativ (mit einem Freund); порядок слов после Am Samstag / Am Abend (глагол на втором месте). Передан смысл всех 4 предложений.",
        },
      ],
    },
    {
      id: "write",
      title: "Письмо",
      skill: "writing",
      items: [
        {
          id: "w1",
          type: "writing",
          // Every content requirement is in the prompt the learner sees; criteria is only the rubric.
          prompt: "Напишите Анне короткое сообщение о своих выходных (40–60 слов). Обязательно: где вы были, с кем, что вам понравилось. В конце задайте Анне один вопрос.",
          min_words: 40,
          max_words: 60,
          points: 10,
          criteria: "4 пункта из инструкции (где, с кем, что понравилось, вопрос) — по 1 баллу; перфект с haben/sein — 3; порядок слов — 2; лексика и орфография — 2.",
        },
        { id: "w2", type: "word_order", prompt: "Составьте предложение.", meaning: "В субботу я ходил в кино.", words: ["Am", "Samstag", "bin", "ich", "ins", "Kino", "gegangen"], accepted: ["Ich bin am Samstag ins Kino gegangen"] },
      ],
    },
    {
      id: "speak",
      title: "Говорение",
      instructions: "Запишите ответы голосом. Можно прослушать себя перед отправкой.",
      items: [
        { id: "s1", type: "read_aloud", prompt: "Прочитайте вслух.", text: "Der Zug nach Köln hat heute fünfzehn Minuten Verspätung.", max_seconds: 20, max_recordings: 2 },
        { id: "s2", type: "repeat", prompt: "Прослушайте и повторите.", text: "Ich hätte gern eine Fahrkarte nach Hamburg.", voice: "Charon", pace: "slow", sample_max_plays: 3, max_recordings: 2 },
        { id: "s3", type: "spoken_response", prompt: "Расскажите (по-немецки), как вы обычно проводите выходные. 3–5 предложений.", criteria: "3–5 связных предложений; настоящее время; минимум 2 конкретных занятия; слова-связки (und, aber, dann).", max_seconds: 50, min_seconds: 15, max_recordings: 2 },
      ],
    },
  ],
};

function getCapabilities(): unknown {
  const speech = speechConfig();
  return {
    flow: [
      "create_assessment (with a client_key, so a retry never duplicates) → draft",
      "prepare_assessment_audio → the app records every listening passage and repeat sample itself with Gemini TTS; call again until all are 'ready' (already-recorded audio is never paid twice)",
      "publish_assessment → link for the learner (the test also appears on the app's home screen)",
      "the learner takes it in the app: choices save on tap, typed text saves as they go, recordings are assessed by Azure on the server; listenings and recordings are counted on the server",
      "get_assessment_results → raw answers, first answers and changes, auto-scores, words the learner marked or looked up, listenings, recordings with transcripts, Azure scores, per-word errors and private links",
      "submit_assessment_review → your scores and comments for writing, translation, free and spoken answers (content), a summary, and the gaps you found",
      "get_learning_gaps → errors, unknown words, pronunciation problems; check_dictionary_words + add_word_batch for a pack, or a new create_assessment for follow-up practice",
    ],
    rules_for_clear_tasks: [
      "Everything the answer must contain goes in the prompt the learner sees. 'criteria' is only your grading rubric and is hidden from the learner.",
      "word_order: if a specific thought must be built, give its Russian sense in 'meaning'; otherwise the learner is told «Соберите грамматически правильное предложение из всех слов». List other correct orders in 'accepted'. Repeated words are separate tiles.",
      "The learner finds it hard to invent a story and write it in German at the same time: for practice writing prefer 'translation' with a ready Russian text (one phrase or a 4–8 sentence story). Translation and own writing are separate kinds of work (skills 'translation' and 'writing').",
    ],
    modes: {
      learning: "Hints, explanations and retries; with results_release 'immediate' each answer is checked at once (choices on tap, typed items with «Проверить»); the right answer shows after a correct reply, «Не знаю», or settings.max_tries wrong ones (default 3). Speaking: Azure feedback shown right after each recording.",
      diagnostic: "No hints, translations, right answers, transcripts or pronunciation feedback until the release point. First answer and every change are kept. Sections default to sequential; listenings default to max 2 plays, recordings to max 2.",
    },
    settings: {
      results_release: `${RESULTS_RELEASE.join(" | ")} — when right answers/explanations/scores become visible. 'immediate' is learning-only (diagnostic turns it into 'after_section'). 'after_review' holds everything until you call submit_assessment_review — but only if something actually needs your grading: a writing task left empty does not keep results locked.`,
      section_order: "sequential | free — sequential opens a section only after the previous one is finished with «Завершить блок».",
      max_tries: "learning mode: checks per item before the answer is shown (default 3).",
      allow_retake: "boolean, default false.",
      allow_word_lookup: "boolean, default true. The learner can tap any word in a task for «Показать перевод» or «Не знаю это слово». Both are always reported to you (results → word_marks, get_learning_gaps → words_the_learner_did_not_know), in diagnostic mode too. Set false to forbid lookups in a strict test.",
    },
    section: {
      fields: "id, title, instructions, skill (reading|listening|writing|translation|speaking|grammar|vocabulary; defaults from the stimulus), stimulus (optional), items",
      advice: "A section is one screen: a reading text with its questions, one recording with its questions, a translation, or a short run (3–8) of grammar items.",
      stimulus_text: "{ type: 'text', title?, paragraphs: string[], translation?: string[] (learning mode only) } — kept in view above the questions.",
      stimulus_audio: "{ type: 'audio', audio: AUDIO, max_plays (1–10; diagnostic default 2; omit in learning for unlimited), unlock_questions: 'immediately' | 'after_first_play', show_transcript: 'never' | 'after_section' | 'after_results' }",
    },
    audio: {
      monologue: "{ kind: 'monologue', text, voice?, pace?: 'slow'|'normal'|'fast', language?, style? }",
      dialogue: "{ kind: 'dialogue', speakers: [{ name, voice }], lines: [{ speaker, text }], pace?, language?, style? } — up to 4 speakers, 40 lines. Two speakers are recorded in one request; more are recorded line by line and joined.",
      style: "Optional direction in English: 'a tired ticket clerk', 'radio announcement'. Speaker names are never read aloud.",
      learner_speed: "The learner can slow any recording down to 0.85× or 0.7× in the player (pitch kept). Use pace: 'slow' when the recording itself should be slow.",
      voices: ASSESSMENT_VOICES,
      model: assessmentTtsModels()[0],
      limits: `${LIMITS.audioChars} characters per passage. Each Gemini speech model allows about 100 recordings a day for the whole app, so keep passages to what the test needs.`,
      listening_rules: [
        "The counter lives on the server: reload, another tab or another device do not reset it.",
        "A play is counted when playback actually starts. A failed download or a playback error before sound does not cost a play.",
        "Pause and resume continue the same play. There is no seeking. Stopping and starting again counts as a new play.",
        "When plays run out the player locks. The transcript stays hidden until show_transcript allows it.",
        "This is control inside the app, not protection against recording the sound.",
      ],
    },
    speaking: {
      service: {
        provider: "Azure AI Speech — Pronunciation Assessment",
        configured: Boolean(speech),
        region: speech?.region ?? null,
        check_live: "get_speech_service_status (no secrets are ever returned)",
      },
      verified_for_german: GERMAN_CAPABILITIES,
      item_types: {
        read_aloud: "{ type:'read_aloud', prompt?, text (target language, shown), max_seconds (3–55, default 30), max_recordings (1–10; diagnostic default 2, learning 5), points (default 3) } — auto-scored: points × Azure pronunciation score / 100.",
        repeat: "{ type:'repeat', prompt?, text (recorded by the app, NOT shown before feedback), voice?, pace?, sample_max_plays (separate from max_recordings; diagnostic default 2), max_seconds, max_recordings, points (default 3) } — auto-scored like read_aloud.",
        spoken_response: "{ type:'spoken_response', prompt (question or situation), criteria (required), min_seconds?, max_seconds (default 45), max_recordings, points (default 5) } — unscripted: Azure measures pronunciation and fluency only; you grade the content from the transcript. No single reference sentence is required.",
      },
      learner_flow: "record → stop → listen to yourself → send. The latest analyzed recording is the answer; earlier ones stay in history.",
      technical_statuses: "Silence, unreadable audio, too long/short, or Azure failure are technical statuses (technical_issue), never a low score, and do not use up a recording. A retried upload of the same recording is not analyzed (or paid) twice.",
      separation: [
        "Azure measures pronunciation: accuracy, fluency, completeness (scripted only), per-word errors. Prosody is null for German. No phoneme names exist for German — never name sounds.",
        "You grade meaning, grammar, vocabulary and task completion from the transcript in submit_assessment_review.",
        "The transcript is what the recognizer heard, not proof of correct pronunciation.",
        "An Azure score is not a CEFR level.",
        "A written dialogue is writing, not speaking.",
      ],
    },
    item_types: {
      common: "id (unique in the test), prompt, points (default 1; gaps 2; writing/translation 10; spoken_response 5; read_aloud/repeat 3), skill?, focus? (meaning|grammar|vocabulary|spelling|instruction|pronunciation — what a wrong answer is an error of; 'spelling' makes umlaut spelling strict), hint? (learning only), explanation? (shown when results are released), criteria? (your rubric, never shown)",
      single_choice: "options: string[] or [{id, text}], correct: option id or exact text — saved the moment it is tapped",
      multiple_choice: "options, correct: array of ids/texts. Partial credit: (right − wrong picks) / right.",
      gap_select: "text with {{1}}, {{2}}…; gaps: [{ id, options: string[], answer }] — a dropdown in each gap",
      gap_text: "text with {{1}}…; gaps: [{ id, answer, accepted?: string[] }]; typo_tolerance (default true; off automatically when focus is 'grammar')",
      word_order: "words: string[] in the correct order (shown shuffled); meaning?: Russian sense; accepted?: other full correct sentences",
      short_answer: "accepted?: string[] — matched ignoring case/punctuation with typo tolerance; anything else waits for your review (never auto-wrong)",
      writing: "min_words?, max_words?, criteria (required) — always graded by you. Put every content requirement in the prompt.",
      translation: "source (ready text in the learner's native language, always visible next to the answer), criteria (required unless accepted), accepted?: string[] (short phrases only; anything else waits for your review). Many correct translations exist — grade meaning and grammar, not a match.",
      read_aloud: "see speaking.item_types",
      repeat: "see speaking.item_types",
      spoken_response: "see speaking.item_types",
    },
    grading: {
      auto: "Closed items are checked on the server. Text answers ignore spacing, quotes and final punctuation.",
      umlauts: "«ae/oe/ue/ss» for «ä/ö/ü/ß» is accepted as fully correct — unless the item has focus: 'spelling'.",
      typos: "A near miss (case, one wrong letter; two in long words) keeps half the points, error_kind 'typo', meaning: ok + spelling: error, and is listed in awaiting_your_review so you can confirm or override.",
      error_kinds: "typo | error | dont_know | skipped | technical — kept apart in results; «Не знаю» is its own status, not a skipped item.",
      skipped: "A skipped item counts as 0 in the total, but skill percentages are over attempted items, with 'skipped' and state 'not_done' reported — a skipped essay is not evidence of weak writing. totals.percent_of_attempted and skipped_points explain the difference.",
      dimensions: DIMENSIONS,
      skills: SKILLS,
    },
    learner_preferences: [
      "Only single words and fixed expressions go into the dictionary and flashcards. Ordinary practice sentences stay in tests, never become cards.",
      "Do not add personal names or organisation names automatically.",
      "A wrong answer does not mean every word in it is unknown — choose review material explicitly; words the learner marked «не знаю» or looked up are the strongest evidence.",
      "For practice writing, give a ready Russian text to translate rather than asking to invent a story.",
    ],
    limits: LIMITS,
    item_type_list: ITEM_TYPES,
    example_create_assessment: EXAMPLE,
  };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function create(ctx: AssessmentCtx, args: Args) {
  try {
    const { row, reused } = await createAssessment(ctx.admin, ctx.userId, args, await targetLanguage(ctx));
    const status = await assessmentStatus(ctx.admin, ctx.userId, row.id, ctx.origin);
    return {
      assessment_id: row.id,
      reused,
      ...(reused ? { note: "A test with this client_key already exists — returned it instead of creating a duplicate. Use update_assessment to change it." } : {}),
      status: status.status,
      sections: status.sections,
      max_score: status.max_score,
      audio: status.audio,
      next_step: status.next_step,
    };
  } catch (error) {
    rethrow(error);
  }
}

async function update(ctx: AssessmentCtx, args: Args) {
  try {
    const id = requireId(args);
    const { row, attemptsKeepTheirVersion } = await updateAssessment(ctx.admin, ctx.userId, id, args);
    const status = await assessmentStatus(ctx.admin, ctx.userId, row.id, ctx.origin);
    return {
      assessment_id: row.id,
      version: row.version,
      status: row.status,
      audio: status.audio,
      note: attemptsKeepTheirVersion > 0
        ? `${attemptsKeepTheirVersion} attempt(s) already started keep the version they started with; only new attempts see this change.`
        : "Updated.",
      next_step: status.next_step,
    };
  } catch (error) {
    rethrow(error);
  }
}

async function prepare(ctx: AssessmentCtx, args: Args) {
  try {
    const id = requireId(args);
    const sectionIds = Array.isArray(args.section_ids) ? args.section_ids.map(String) : undefined;
    const result = await prepareAudio(ctx.admin, ctx.userId, id, { sectionIds, force: args.force === true });
    const pending = result.audio.filter((a) => a.status !== "ready");
    return {
      assessment_id: id,
      generated_now: result.generated,
      audio: result.audio,
      all_ready: pending.length === 0,
      next_step: pending.length === 0
        ? "All audio is ready — call publish_assessment."
        : pending.some((a) => a.status === "error")
          ? "Some recordings failed (see 'error'). Call prepare_assessment_audio again to retry; a quota error usually clears within a minute."
          : "Recording continues — call prepare_assessment_audio again (finished recordings are not redone).",
    };
  } catch (error) {
    rethrow(error);
  }
}

async function status(ctx: AssessmentCtx, args: Args) {
  try {
    const result = await assessmentStatus(ctx.admin, ctx.userId, requireId(args), ctx.origin);
    const config = speechConfig();
    return {
      ...result,
      speech_service: result.speaking_items.length > 0
        ? { configured: Boolean(config), region: config?.region ?? null, live_check: "get_speech_service_status" }
        : null,
    };
  } catch (error) {
    rethrow(error);
  }
}

async function speechStatus() {
  const live = await checkSpeechService();
  return {
    ...live,
    german: GERMAN_CAPABILITIES,
    note: live.ok
      ? "Speaking tasks will be assessed. Keys are never returned by this connection."
      : "Speaking tasks can still be created, but recordings will come back as a technical status until the server's AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are fixed.",
  };
}

async function publish(ctx: AssessmentCtx, args: Args) {
  try {
    return await publishAssessment(ctx.admin, ctx.userId, requireId(args), ctx.origin);
  } catch (error) {
    rethrow(error);
  }
}

async function list(ctx: AssessmentCtx, args: Args) {
  try {
    const tests = await listAssessments(ctx.admin, ctx.userId, {
      status: typeof args.status === "string" ? args.status : undefined,
      limit: Number(args.limit) || undefined,
    });
    return { tests: tests.map((t) => ({ ...t, link: t.status === "published" ? testLink(ctx.origin, t.id) : null })) };
  } catch (error) {
    rethrow(error);
  }
}

async function results(ctx: AssessmentCtx, args: Args) {
  try {
    return await assessmentResults(ctx.admin, ctx.userId, args);
  } catch (error) {
    rethrow(error);
  }
}

async function review(ctx: AssessmentCtx, args: Args) {
  try {
    return await submitReview(ctx.admin, ctx.userId, args);
  } catch (error) {
    rethrow(error);
  }
}

async function gaps(ctx: AssessmentCtx, args: Args) {
  try {
    return await learningGaps(ctx.admin, ctx.userId, args);
  } catch (error) {
    rethrow(error);
  }
}

/** «der Bahnhof», «Bahnhof», «BAHNHOF» are one word to a learner. */
export function dictionaryKey(value: string): string {
  return value
    .normalize("NFC")
    .toLowerCase()
    .replace(/[.!?,;:"«»„“]/g, "")
    .replace(/^(der|die|das|den|dem|des|ein|eine|einen|sich|to|the|a|an|le|la|les|el|los|las)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function checkWords(ctx: AssessmentCtx, args: Args) {
  const words = (Array.isArray(args.words) ? args.words : []).map((w) => String(w).trim()).filter(Boolean).slice(0, 200);
  if (words.length === 0) throw new Error("Pass 'words': the headwords you are thinking of adding.");

  const [{ data: entries }, { data: cards }, { data: batches }] = await Promise.all([
    ctx.admin.from("dictionary_entries").select("headword, lemma, translation, batch_id").eq("user_id", ctx.userId).limit(10000),
    ctx.admin.from("flashcards").select("id, front, back, source_book_title").eq("user_id", ctx.userId).limit(10000),
    ctx.admin.from("dictionary_batches").select("id, title").eq("user_id", ctx.userId),
  ]);
  const batchTitle = new Map((batches ?? []).map((b) => [b.id as string, b.title as string]));

  const report = words.map((word) => {
    const key = dictionaryKey(word);
    const inDictionary = (entries ?? [])
      .filter((e) => dictionaryKey(String(e.headword ?? "")) === key || dictionaryKey(String(e.lemma ?? "")) === key)
      .map((e) => ({ headword: e.headword, translation: e.translation, pack: batchTitle.get(e.batch_id as string) ?? null }));
    const inCards = (cards ?? [])
      .filter((c) => dictionaryKey(String(c.front ?? "")) === key)
      .map((c) => ({ card_id: c.id, front: c.front, back: c.back }));
    return {
      word,
      known: inDictionary.length > 0 || inCards.length > 0,
      in_dictionary: inDictionary.slice(0, 5),
      in_flashcards: inCards.slice(0, 5),
    };
  });
  return {
    checked: report.length,
    new_words: report.filter((r) => !r.known).map((r) => r.word),
    already_known: report.filter((r) => r.known).map((r) => r.word),
    words: report,
    note: "Articles and case are ignored when matching. add_word_batch would also merge duplicates on its own, but leaving known words out keeps the pack about what is actually new.",
  };
}

// ─── Definitions ─────────────────────────────────────────────────────────────

const ID = { assessment_id: { type: "string", description: "From create_assessment or list_assessments" } };

const SECTIONS_SCHEMA = {
  type: "array",
  description: "Sections («блоки»), each one screen in the app. Full shape and an example: get_assessment_capabilities.",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      instructions: { type: "string", description: "In the learner's native language" },
      skill: { type: "string", enum: [...SKILLS] },
      stimulus: { type: "object", description: "{type:'text', paragraphs[]} or {type:'audio', audio:{kind:'monologue'|'dialogue',…}, max_plays}" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            type: { type: "string", enum: [...ITEM_TYPES] },
            prompt: { type: "string" },
            points: { type: "number" },
          },
          required: ["type"],
        },
      },
    },
    required: ["items"],
  },
};

export const ASSESSMENT_TOOLS: McpToolDef[] = [
  {
    name: "get_assessment_capabilities",
    title: "Что умеют тесты",
    description:
      "Everything about interactive tests in one read: item types with their fields, learning vs diagnostic mode, results release, listening rules, voices for the app's own Gemini speech, grading rules (typos, dimensions, skills), the learner's preferences for review packs, limits, and a complete create_assessment example. Read it before building the first test.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "Что умеют тесты" },
  },
  {
    name: "create_assessment",
    title: "Создать тест",
    description:
      "Create a draft interactive test the learner takes inside aibook («проверь мой немецкий»): reading texts with questions, listening (monologue or dialogue — send only the words, the app records them itself), choice, gaps, word order, short answers, translation of a ready Russian text, writing, and speaking (read aloud, listen-and-repeat, free spoken answer — assessed by Azure pronunciation assessment). Idempotent with 'client_key': repeating the call after a failure returns the same test. Every problem in the input is listed in one error. Then: prepare_assessment_audio (if there is audio) → publish_assessment.",
    inputSchema: {
      type: "object",
      properties: {
        client_key: { type: "string", description: "Your idempotency key for this test — reuse it on retries" },
        title: { type: "string", description: "In the learner's native language" },
        description: { type: "string" },
        mode: { type: "string", enum: ["learning", "diagnostic"], description: "diagnostic (default): no hints or answers until released; learning: hints, feedback and retries" },
        language: { type: "string", description: "ISO code of the language being tested; defaults to the learner's target language" },
        settings: {
          type: "object",
          properties: {
            results_release: { type: "string", enum: [...RESULTS_RELEASE] },
            section_order: { type: "string", enum: ["sequential", "free"] },
            max_tries: { type: "number" },
            allow_retake: { type: "boolean" },
          },
        },
        sections: SECTIONS_SCHEMA,
      },
      required: ["title", "sections"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, idempotentHint: true, title: "Создать тест" },
  },
  {
    name: "update_assessment",
    title: "Изменить тест",
    description:
      "Change a test: any of title, description, mode, language, settings (merged) or sections (replaced whole — send the full list). Attempts the learner has already started keep the version they started with, so answers are always graded against what was on their screen. Changed listening texts are re-recorded by prepare_assessment_audio; unchanged ones keep their audio. Pass status: 'archived' to retire a test.",
    inputSchema: {
      type: "object",
      properties: {
        ...ID,
        title: { type: "string" },
        description: { type: "string" },
        mode: { type: "string", enum: ["learning", "diagnostic"] },
        language: { type: "string" },
        settings: { type: "object" },
        sections: SECTIONS_SCHEMA,
        status: { type: "string", enum: ["archived"] },
      },
      required: ["assessment_id"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, idempotentHint: true, title: "Изменить тест" },
  },
  {
    name: "prepare_assessment_audio",
    title: "Озвучить аудирование",
    description:
      "Record the test's listening passages with the app's own Gemini TTS — no API key or audio file from you. Records whatever is pending or failed within about half a minute and reports each section as pending / ready / error; call again until all are ready. Safe to repeat: a recording that is ready (in this or any earlier test with the same text and voices) is never requested again, and two overlapping calls never record the same passage twice. 'force' re-records even ready audio.",
    inputSchema: {
      type: "object",
      properties: {
        ...ID,
        section_ids: { type: "array", items: { type: "string" }, description: "Only these sections" },
        force: { type: "boolean", description: "Re-record even if ready (spends quota)" },
      },
      required: ["assessment_id"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, idempotentHint: true, openWorldHint: true, title: "Озвучить аудирование" },
  },
  {
    name: "get_assessment_status",
    title: "Готовность теста",
    description:
      "Is the test ready: sections, max score, which items need your manual grading, each recording's status (with its error), whether it can be published, the learner's link once published, and the attempts so far.",
    inputSchema: { type: "object", properties: { ...ID }, required: ["assessment_id"], additionalProperties: false },
    annotations: { ...READ_ONLY, title: "Готовность теста" },
  },
  {
    name: "publish_assessment",
    title: "Опубликовать тест",
    description:
      "Make a ready test available to the learner and get the link to give them (it also shows on the app's home screen). Refuses, naming the sections, while any recording is not ready.",
    inputSchema: { type: "object", properties: { ...ID }, required: ["assessment_id"], additionalProperties: false },
    annotations: { ...WRITES, idempotentHint: true, title: "Опубликовать тест" },
  },
  {
    name: "list_assessments",
    title: "Список тестов",
    description:
      "The learner's tests, newest first, with their status, link and every attempt (in progress / submitted / reviewed, with score totals and how many items wait for your review).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["draft", "published", "archived"] },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Список тестов" },
  },
  {
    name: "get_assessment_results",
    title: "Результаты теста",
    description:
      "One attempt in full: for every item the exact raw answer and a readable version, the first answer and every change, «не знаю» marks, error kind (typo / error / dont_know / skipped / technical), dimensions (meaning, grammar, vocabulary, spelling, instruction, pronunciation), the expected answer and your criteria; words the learner tapped as unknown or looked up; listenings per section with timestamps and the transcript; for speaking items every recording with transcript, Azure scores, per-word errors, the raw Azure answer and a private 1-hour link; unfinished items; scores by skill (skipped items reported separately); and awaiting_your_review — the writing, translation, free and spoken answers and typo-near-misses you need to grade with submit_assessment_review.",
    inputSchema: {
      type: "object",
      properties: {
        attempt_id: { type: "string" },
        assessment_id: { type: "string", description: "Its latest attempt, if you have no attempt_id" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Результаты теста" },
  },
  {
    name: "submit_assessment_review",
    title: "Оценить ответы",
    description:
      "Your grading of a submitted attempt: per item a score (0…points), a comment for the learner in their native language, per-dimension marks (ok | minor | error for meaning, grammar, vocabulary, spelling, instruction) and an optional corrected version; plus a summary and the gaps you found (topic, skill, description, words to review). Overrides the auto-check where you disagree. Calls add up — a second call adds to the first. Once every writing/free answer is graded the attempt becomes 'reviewed' and the learner sees results (unless you pass final: false).",
    inputSchema: {
      type: "object",
      properties: {
        attempt_id: { type: "string" },
        assessment_id: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              item_id: { type: "string" },
              score: { type: "number" },
              comment: { type: "string" },
              dimensions: {
                type: "object",
                properties: Object.fromEntries(DIMENSIONS.map((d) => [d, { type: "string", enum: ["ok", "minor", "error"] }])),
              },
              corrected: { type: "string", description: "The learner's text with your corrections" },
            },
            required: ["item_id", "score"],
          },
        },
        summary: { type: "string", description: "Overall feedback the learner reads, in their native language" },
        gaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              skill: { type: "string", enum: [...SKILLS] },
              description: { type: "string" },
              words: { type: "array", items: { type: "string" } },
            },
          },
        },
        final: { type: "boolean", description: "false keeps results hidden even if everything is graded" },
      },
      additionalProperties: false,
    },
    annotations: { ...WRITES, idempotentHint: true, title: "Оценить ответы" },
  },
  {
    name: "get_learning_gaps",
    title: "Пробелы по тестам",
    description:
      "What the tests showed the learner does not know yet: every wrong, partial or «не знаю» answer with the learner's words, the expected answer and the error dimension, plus the gaps you recorded in reviews — for one attempt, one test, or the last few finished attempts. Ends with the learner's rules for turning it into a review pack (check_dictionary_words, then add_word_batch with words and fixed expressions only).",
    inputSchema: {
      type: "object",
      properties: {
        attempt_id: { type: "string" },
        assessment_id: { type: "string" },
        limit: { type: "number", description: "Recent finished attempts to scan when no id is given (default 5)" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Пробелы по тестам" },
  },
  {
    name: "get_speech_service_status",
    title: "Проверка оценки произношения",
    description:
      "Is speaking assessment ready: checks the server's Azure Speech key and region with a free token request and reports configured / ok / region / the error, plus what was verified for German (which scores exist, that prosody and phoneme names do not). Never returns a key.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, openWorldHint: true, title: "Проверка оценки произношения" },
  },
  {
    name: "check_dictionary_words",
    title: "Есть ли уже эти слова",
    description:
      "Check up to 200 words against the learner's dictionary and flashcards before building a pack, ignoring articles and case («der Bahnhof» = «Bahnhof»). Returns new_words, already_known, and where each known one lives, so a review pack carries only what is actually new.",
    inputSchema: {
      type: "object",
      properties: { words: { type: "array", items: { type: "string" } } },
      required: ["words"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Есть ли уже эти слова" },
  },
];

export const ASSESSMENT_HANDLERS: Record<string, (ctx: AssessmentCtx, args: Args) => Promise<unknown>> = {
  get_assessment_capabilities: async () => getCapabilities(),
  create_assessment: create,
  update_assessment: update,
  prepare_assessment_audio: prepare,
  get_assessment_status: status,
  publish_assessment: publish,
  list_assessments: list,
  get_assessment_results: results,
  submit_assessment_review: review,
  get_learning_gaps: gaps,
  check_dictionary_words: checkWords,
  get_speech_service_status: speechStatus,
};
