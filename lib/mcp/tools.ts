// The tools the MCP endpoint exposes to external agents.
//
// Everything here is plain database work scoped to one verified user — no
// Gemini calls, so a connected agent never spends the owner's API budget. The
// agent composing the story IS the language model; it supplies finished text
// and this module only stores it the same way the in-app generator does
// (saveGeneratedLesson), so lessons land in "Мои уроки" indistinguishably.
//
// Tool names and descriptions are in English because every MCP client model
// reads English schemas best; the data inside is whatever language it is.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createDefaultSrsFields } from "@/lib/srs/sm2";
import { normalizeCardText } from "@/lib/cards";
import { saveGeneratedLesson } from "@/lib/db/lessonStore";
import {
  createCardsForEntries,
  dedupeDictionaryDrafts,
  discardDictionaryBatch,
  saveDictionaryEntries,
} from "@/lib/db/dictionaryStore";
import { applyNounFieldRules, type DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";
import { estimateLevel } from "@/lib/text/readability";
import { buildKnownWordSet, buildWordCounts, computeCoverage } from "@/lib/text/vocab";
import type { GeneratedLesson } from "@/lib/ai/buildLessonPrompt";
import type { CefrLevel } from "@/lib/types";
import { AGENT_LIMITS, AGENT_TIPS, CAPABILITY_AREAS } from "@/lib/mcp/capabilities";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const CARD_TYPES = ["word", "phrase", "sentence"] as const;

// How many catalogue texts may be word-counted inside one call when their
// stored frequency data is missing. Enough to fill a page of suggestions,
// small enough that the request still finishes inside the function's budget.
const COUNTED_ON_THE_FLY = 30;

// Hints defined by the MCP spec. They are what lets a client show a read tool
// and a destructive one differently — and what stops a cautious agent from
// treating every tool as dangerous and asking before each call.
export type McpToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

export type McpToolDef = {
  name: string;
  /** Human-readable name, in the learner's language: clients show it in their UI. */
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: McpToolAnnotations;
};

/** Reads touch nothing; the world outside aibook is never involved. */
const READ_ONLY: McpToolAnnotations = { readOnlyHint: true, openWorldHint: false };
const WRITES: McpToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE: McpToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

type Ctx = { admin: SupabaseClient; userId: string };
type Args = Record<string, unknown>;

// ─── Shared lookups ──────────────────────────────────────────────────────────

async function getLanguages(ctx: Ctx): Promise<{ target: string; native: string }> {
  const { data } = await ctx.admin
    .from("user_settings")
    .select("active_target_lang, native_language")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return {
    target: (data?.active_target_lang as string) || "de",
    native: (data?.native_language as string) || "ru",
  };
}

type CardRow = {
  id: string;
  front: string;
  back: string;
  status: string | null;
  repetitions: number | null;
  lapses: number | null;
  easiness_factor: number | null;
  interval_days: number | null;
  next_review_at: string | null;
  source_book_id: string | null;
  source_book_title: string | null;
  selection_type: string | null;
  cefr: string | null;
};

const CARD_COLUMNS =
  "id, front, back, status, repetitions, lapses, easiness_factor, interval_days, next_review_at, source_book_id, source_book_title, selection_type, cefr";

async function getCards(ctx: Ctx): Promise<CardRow[]> {
  const { data, error } = await ctx.admin
    .from("flashcards")
    .select(CARD_COLUMNS)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`flashcards read failed: ${error.message}`);
  return (data ?? []) as CardRow[];
}

// A card counts as "learned" once it has survived three consecutive reviews —
// same heuristic the agents are told about in the tool descriptions.
const LEARNED_REPETITIONS = 3;

function isDue(card: CardRow): boolean {
  return !card.next_review_at || new Date(card.next_review_at) <= new Date();
}

// The three directions a card is trained in. "forward" lives on the flashcard
// row itself; the other two have their own schedules in a side table, so a word
// can be firm one way round and unlearned the other.
type VariantRow = {
  flashcard_id: string;
  variant: "reverse" | "audio";
  repetitions: number | null;
  lapses: number | null;
  next_review_at: string | null;
};

const SKILL_NAMES: Record<"forward" | "reverse" | "audio", string> = {
  forward: "recognition (sees the target word, recalls the meaning)",
  reverse: "recall (sees the meaning, produces the target word)",
  audio: "listening (hears the word)",
};

async function getVariantProgress(ctx: Ctx): Promise<VariantRow[]> {
  const { data, error } = await ctx.admin
    .from("flashcard_variant_progress")
    .select("flashcard_id, variant, repetitions, lapses, next_review_at")
    .eq("user_id", ctx.userId);
  // The table arrived in a later migration; an installation without it should
  // still answer everything else rather than failing the whole call.
  if (error) return [];
  return (data ?? []) as VariantRow[];
}

/** Cards belonging to one dictionary batch, by id where possible. */
function cardsOfBatch(cards: CardRow[], batchId: string, batchTitle: string): CardRow[] {
  const byId = cards.filter((c) => c.source_book_id === batchId);
  if (byId.length > 0) return byId;
  // Batches created before cards carried the batch id are still recognisable
  // by the title stamped on their cards.
  return cards.filter((c) => !c.source_book_id && c.source_book_title === batchTitle);
}

/** PostgREST filter strings are comma-separated; user text must not break out. */
function sanitizeSearch(value: string): string {
  return value.replace(/[,()*%\\]/g, " ").trim().slice(0, 80);
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function getOverview(ctx: Ctx): Promise<unknown> {
  const [langs, cards, lessons, lessonCount, progress, batches, entryCount] = await Promise.all([
    getLanguages(ctx),
    getCards(ctx),
    ctx.admin
      .from("shared_books")
      .select("id, title, cefr_level, language, created_at")
      .eq("owner_user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(10),
    ctx.admin
      .from("shared_books")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", ctx.userId),
    ctx.admin
      .from("user_lesson_progress")
      .select("shared_book_id, status, percentage")
      .eq("user_id", ctx.userId),
    ctx.admin
      .from("dictionary_batches")
      .select("id, title, topic, word_count, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(5),
    ctx.admin
      .from("dictionary_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId),
  ]);

  const progressRows = progress.data ?? [];
  return {
    app: "aibook — language-learning app: reading texts, a personal dictionary in batches, and a spaced-repetition deck",
    target_language: langs.target,
    native_language: langs.native,
    flashcards: {
      total: cards.length,
      due_now: cards.filter(isDue).length,
      learned: cards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS).length,
      note: `learned = ${LEARNED_REPETITIONS}+ successful reviews in a row, in the recognition direction`,
    },
    dictionary: {
      words: entryCount.count ?? 0,
      batches: (batches.data ?? []).map((b) => ({
        id: b.id, title: b.title, topic: b.topic, words: b.word_count,
      })),
      note: "A batch («пачка») is one page of vocabulary the learner was set to learn. list_word_batches shows them all with progress.",
    },
    my_lessons: {
      total: lessonCount.count ?? (lessons.data ?? []).length,
      recent: (lessons.data ?? []).map((l) => ({
        id: l.id, title: l.title, level: l.cefr_level, language: l.language,
      })),
    },
    reading_progress: {
      texts_completed: progressRows.filter((p) => p.status === "completed").length,
      texts_in_progress: progressRows.filter((p) => p.status === "in_progress").length,
    },
    // Repeated here because most clients show the model the result of the first
    // tool call far more reliably than they show it the server's instructions.
    what_you_can_do: CAPABILITY_AREAS.map((a) => `${a.area}: ${a.tools.join(", ")}`),
    full_guide: "Call get_capabilities for what each of those does and when to use it.",
  };
}

function getCapabilities(): unknown {
  const byName = new Map(MCP_TOOLS.map((t) => [t.name, t]));
  return {
    app: "aibook — language-learning app (reading texts, a personal dictionary in batches, a spaced-repetition deck)",
    your_role:
      "You are the teacher on the other end of this connection. You write the texts and choose the words; these tools put them into the learner's app, where the app schedules and drills them.",
    areas: CAPABILITY_AREAS.map((area) => ({
      area: area.area,
      what_it_is: area.summary,
      the_learner_says: area.say,
      tools: area.tools.map((name) => ({
        name,
        does: byName.get(name)?.description ?? "",
        writes: byName.get(name)?.annotations?.readOnlyHint === false,
      })),
    })),
    tips: AGENT_TIPS,
    not_available: AGENT_LIMITS,
  };
}

async function getStudyWords(ctx: Ctx, args: Args): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 200, 1), 500);
  const cards = await getCards(ctx);
  const learned: string[] = [];
  const learning: string[] = [];
  for (const card of cards) {
    ((card.repetitions ?? 0) >= LEARNED_REPETITIONS ? learned : learning).push(card.front);
  }
  return {
    learned: learned.slice(0, limit),
    still_learning: learning.slice(0, limit),
    note: "When writing a story for the learner, build it mostly from 'learned' words and weave in a few 'still_learning' ones naturally.",
  };
}

const CARD_FILTERS = ["all", "due", "learned", "new", "struggling"] as const;
type CardFilter = typeof CARD_FILTERS[number];

function isStruggling(card: CardRow): boolean {
  const lapses = card.lapses ?? 0;
  return lapses >= 2 || (lapses >= 1 && (card.easiness_factor ?? 2.5) <= 2.2);
}

async function listFlashcards(ctx: Ctx, args: Args): Promise<unknown> {
  const filter: CardFilter = CARD_FILTERS.includes(args.filter as CardFilter)
    ? (args.filter as CardFilter)
    : "all";
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
  const search = typeof args.search === "string" ? normalizeCardText(args.search) : "";
  const batchId = typeof args.batch_id === "string" ? args.batch_id.trim() : "";

  let cards = await getCards(ctx);
  if (filter === "due") cards = cards.filter(isDue);
  if (filter === "learned") cards = cards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS);
  if (filter === "new") cards = cards.filter((c) => (c.repetitions ?? 0) === 0);
  if (filter === "struggling") cards = cards.filter(isStruggling);
  if (batchId) cards = cards.filter((c) => c.source_book_id === batchId);
  if (search) {
    cards = cards.filter(
      (c) => normalizeCardText(c.front).includes(search) || normalizeCardText(c.back).includes(search),
    );
  }

  return {
    total: cards.length,
    returned: Math.min(cards.length, limit),
    cards: cards.slice(0, limit).map((c) => ({
      // The id is what update_flashcard and delete_flashcards take.
      id: c.id,
      front: c.front,
      back: c.back,
      type: c.selection_type ?? "word",
      level: c.cefr ?? "",
      status: c.status ?? "new",
      repetitions: c.repetitions ?? 0,
      lapses: c.lapses ?? 0,
      next_review_at: c.next_review_at,
      source: c.source_book_title,
      batch_id: c.source_book_id,
    })),
  };
}

async function updateFlashcard(ctx: Ctx, args: Args): Promise<unknown> {
  const id = String(args.id ?? "").trim();
  const match = String(args.front_match ?? "").trim();
  if (!id && !match) throw new Error("Pass the card 'id' (from list_flashcards) or 'front_match' — its exact front text.");

  const cards = await getCards(ctx);
  const card = id
    ? cards.find((c) => c.id === id)
    : cards.find((c) => normalizeCardText(c.front) === normalizeCardText(match));
  if (!card) throw new Error("No such card in this learner's deck.");

  const patch: Record<string, unknown> = {};
  if (typeof args.front === "string" && args.front.trim()) patch.front = args.front.trim().slice(0, 500);
  if (typeof args.back === "string" && args.back.trim()) patch.back = args.back.trim().slice(0, 1000);
  if (typeof args.level === "string" && LEVELS.includes(args.level as CefrLevel)) patch.cefr = args.level;
  if (Object.keys(patch).length === 0) {
    throw new Error("Nothing to change: pass 'front', 'back' or 'level'.");
  }

  // The schedule is deliberately untouched — a corrected translation must not
  // cost the learner weeks of spaced repetition on that word.
  const { error } = await ctx.admin
    .from("flashcards")
    .update(patch)
    .eq("id", card.id)
    .eq("user_id", ctx.userId);
  if (error) throw new Error(`flashcard update failed: ${error.message}`);

  return {
    id: card.id,
    was: { front: card.front, back: card.back },
    now: { front: patch.front ?? card.front, back: patch.back ?? card.back },
    note: "Review history left as it was.",
  };
}

async function deleteFlashcards(ctx: Ctx, args: Args): Promise<unknown> {
  const ids = (Array.isArray(args.ids) ? args.ids : [])
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .slice(0, 50);
  if (ids.length === 0) throw new Error("Pass 'ids' — card ids from list_flashcards. Up to 50 at a time.");

  const cards = await getCards(ctx);
  const owned = cards.filter((c) => ids.includes(c.id));
  if (owned.length === 0) throw new Error("None of those ids are cards in this learner's deck.");

  const { error } = await ctx.admin
    .from("flashcards")
    .delete()
    .in("id", owned.map((c) => c.id))
    .eq("user_id", ctx.userId);
  if (error) throw new Error(`flashcard delete failed: ${error.message}`);

  return {
    deleted: owned.map((c) => c.front),
    skipped_unknown_ids: ids.filter((id) => !owned.some((c) => c.id === id)),
    note: "Deleting a card throws away its review history. The dictionary entry the card came from is left alone.",
  };
}

async function addFlashcards(ctx: Ctx, args: Args): Promise<unknown> {
  const rawCards = Array.isArray(args.cards) ? args.cards.slice(0, 100) : [];
  const source = typeof args.source === "string" && args.source.trim()
    ? args.source.trim().slice(0, 120)
    : "Из чата с ИИ";

  const incoming = rawCards
    .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
    .map((c) => ({
      front: String(c.front ?? "").trim().slice(0, 500),
      back: String(c.back ?? "").trim().slice(0, 1000),
      type: CARD_TYPES.includes(c.type as typeof CARD_TYPES[number])
        ? (c.type as typeof CARD_TYPES[number])
        : "word",
    }))
    .filter((c) => c.front && c.back);

  if (incoming.length === 0) {
    throw new Error("No valid cards: each card needs non-empty 'front' (target language) and 'back' (translation).");
  }

  const existing = await getCards(ctx);
  const known = new Set(existing.map((c) => normalizeCardText(c.front)));

  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const card of incoming) {
    const norm = normalizeCardText(card.front);
    if (known.has(norm)) {
      skipped.push(card.front);
      continue;
    }
    known.add(norm); // also dedupes inside one call
    const srs = createDefaultSrsFields(null, source);
    rows.push({
      user_id: ctx.userId,
      vocabulary_item_id: null,
      front: card.front,
      back: card.back,
      source_book_title: source,
      selection_type: card.type,
      repetitions: srs.repetitions,
      lapses: srs.lapses,
      easiness_factor: srs.easeFactor,
      interval_days: srs.intervalDays,
      next_review_at: srs.dueAt,
      last_reviewed_at: srs.lastReviewedAt,
      source_book_id: null,
      status: srs.status,
    });
  }

  if (rows.length > 0) {
    const { error } = await ctx.admin.from("flashcards").insert(rows);
    if (error) throw new Error(`flashcards insert failed: ${error.message}`);
  }

  return {
    added: rows.length,
    skipped_as_duplicates: skipped,
    note: "Cards appear in the app after the learner reopens or refreshes it.",
  };
}

async function createLesson(ctx: Ctx, args: Args): Promise<unknown> {
  const title = String(args.title ?? "").trim().slice(0, 200);
  const paragraphs = Array.isArray(args.paragraphs)
    ? args.paragraphs
        .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
        .map((p) => p.trim())
        .slice(0, 60)
    : [];

  if (!title || paragraphs.length === 0) {
    throw new Error("A lesson needs a 'title' and at least one entry in 'paragraphs' (the text in the target language).");
  }

  const langs = await getLanguages(ctx);
  const targetLanguage = typeof args.target_language === "string" && args.target_language.trim()
    ? args.target_language.trim().slice(0, 10)
    : langs.target;

  const vocabulary = Array.isArray(args.vocabulary)
    ? args.vocabulary
        .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
        .map((v) => ({
          term: String(v.term ?? "").trim().slice(0, 200),
          translation: String(v.translation ?? "").trim().slice(0, 200),
        }))
        .filter((v) => v.term)
        .slice(0, 30)
    : [];

  const questions = Array.isArray(args.questions)
    ? args.questions
        .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
        .map((q) => q.trim().slice(0, 300))
        .slice(0, 10)
    : [];

  const lesson: GeneratedLesson = {
    title,
    description: String(args.description ?? "").trim().slice(0, 500),
    paragraphs,
    vocabulary,
    questions,
  };

  // The agent may know the level it wrote at; otherwise measure the text.
  const measured = estimateLevel(paragraphs.join(" "));
  const level: CefrLevel = LEVELS.includes(args.level as CefrLevel)
    ? (args.level as CefrLevel)
    : measured.level;

  const saved = await saveGeneratedLesson(ctx.admin, {
    userId: ctx.userId,
    lesson,
    level,
    targetLanguage,
    nativeLanguage: langs.native,
    extraMetadata: {
      origin: "mcp",
      level_estimated: !LEVELS.includes(args.level as CefrLevel),
      lix: measured.lix,
    },
  });
  if (!saved.ok) throw new Error(saved.error);

  return {
    id: saved.id,
    title,
    level,
    language: targetLanguage,
    note: "Saved into the learner's «Мои уроки». It appears in the app's catalogue after a refresh.",
  };
}

async function listTexts(ctx: Ctx, args: Args): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);

  const [{ data: lessons, error }, { data: progress }] = await Promise.all([
    ctx.admin
      .from("shared_books")
      .select("id, title, cefr_level, language, created_at, metadata")
      .eq("owner_user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    ctx.admin
      .from("user_lesson_progress")
      .select("shared_book_id, status, percentage")
      .eq("user_id", ctx.userId),
  ]);
  if (error) throw new Error(`lessons read failed: ${error.message}`);

  const progressById = new Map(
    (progress ?? []).map((p) => [p.shared_book_id as string, p]),
  );

  return {
    texts: (lessons ?? []).map((l) => {
      const meta = (l.metadata ?? {}) as Record<string, unknown>;
      const prog = progressById.get(l.id as string);
      return {
        id: l.id,
        title: l.title,
        level: l.cefr_level,
        language: l.language,
        description: typeof meta.description === "string" ? meta.description : "",
        created_at: l.created_at,
        reading_status: prog?.status ?? "not_started",
        reading_percentage: prog?.percentage ?? 0,
      };
    }),
  };
}

async function getText(ctx: Ctx, args: Args): Promise<unknown> {
  const id = String(args.id ?? "").trim();
  if (!id) throw new Error("Pass the text 'id' from list_texts or get_overview.");

  const { data: book } = await ctx.admin
    .from("shared_books")
    .select("id, title, cefr_level, language, owner_user_id, metadata")
    .eq("id", id)
    .maybeSingle();

  // Public catalogue texts (owner null) are readable too; other users' private
  // lessons are not, and must not leak even through an authenticated token.
  if (!book || (book.owner_user_id && book.owner_user_id !== ctx.userId)) {
    throw new Error("Text not found.");
  }

  const { data: chapters } = await ctx.admin
    .from("shared_book_chapters")
    .select("paragraphs")
    .eq("shared_book_id", id)
    .order("chapter_index", { ascending: true });

  const meta = (book.metadata ?? {}) as Record<string, unknown>;
  return {
    id: book.id,
    title: book.title,
    level: book.cefr_level,
    language: book.language,
    description: typeof meta.description === "string" ? meta.description : "",
    paragraphs: (chapters ?? []).flatMap((c) => (c.paragraphs as string[] | null) ?? []),
  };
}

// ─── The dictionary: batches of words the learner was set to learn ──────────

type DictRow = {
  id: string; batch_id: string | null; headword: string; lemma: string;
  translation: string; part_of_speech: string; cefr: string; example: string;
};

async function listBatches(ctx: Ctx): Promise<unknown> {
  const [{ data: batches, error }, cards] = await Promise.all([
    ctx.admin
      .from("dictionary_batches")
      .select("id, title, kind, topic, language, word_count, created_at")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(100),
    getCards(ctx),
  ]);
  if (error) throw new Error(`batches read failed: ${error.message}`);

  return {
    explanation:
      "A batch («пачка») is one page of vocabulary — usually photographed from the learner's coursebook — kept together as the unit they were set to learn. In the app it has its own progress bar and its own «тренировать» button. Progress is measured from the flashcards made from those words.",
    batches: (batches ?? []).map((b) => {
      const batchCards = cardsOfBatch(cards, b.id as string, b.title as string);
      const learned = batchCards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS).length;
      const started = batchCards.filter((c) => (c.repetitions ?? 0) > 0).length;
      return {
        id: b.id,
        title: b.title,
        topic: b.topic,
        page: b.kind,
        language: b.language,
        words: b.word_count,
        created_at: b.created_at,
        progress: batchCards.length > 0
          ? {
              cards: batchCards.length,
              started,
              learned,
              struggling: batchCards.filter(isStruggling).length,
              percent: Math.round((started / batchCards.length) * 100),
            }
          : null,
      };
    }),
    next: "list_batch_words shows one batch in full; add_words_to_batch adds to it; add_word_batch starts a new one.",
  };
}

async function searchDictionary(ctx: Ctx, args: Args): Promise<unknown> {
  const query = sanitizeSearch(String(args.query ?? ""));
  const batchId = String(args.batch_id ?? "").trim();
  const level = String(args.level ?? "").trim().toUpperCase();
  const pos = sanitizeSearch(String(args.part_of_speech ?? ""));
  const limit = Math.min(Math.max(Number(args.limit) || 50, 1), 300);

  let request = ctx.admin
    .from("dictionary_entries")
    .select("id, batch_id, headword, lemma, translation, part_of_speech, gender, plural, forms, cefr, note, example, example_translation")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (query) {
    request = request.or(
      `headword.ilike.%${query}%,lemma.ilike.%${query}%,translation.ilike.%${query}%,example.ilike.%${query}%`,
    );
  }
  if (batchId) request = request.eq("batch_id", batchId);
  if (LEVELS.includes(level as CefrLevel)) request = request.eq("cefr", level);
  if (pos) request = request.ilike("part_of_speech", `%${pos}%`);

  const { data, error } = await request;
  if (error) throw new Error(`dictionary search failed: ${error.message}`);

  return {
    found: (data ?? []).length,
    words: data ?? [],
    note: "The dictionary is reference material: the full entry as a dictionary would print it. Whether the learner is actually learning a word is in the flashcards (list_flashcards, get_progress).",
  };
}

async function listBatchWords(ctx: Ctx, args: Args): Promise<unknown> {
  const batchId = String(args.batch_id ?? "").trim();
  if (!batchId) throw new Error("Pass 'batch_id' from list_word_batches.");

  const { data, error } = await ctx.admin
    .from("dictionary_entries")
    .select("headword, lemma, translation, part_of_speech, cefr, plural, forms, example")
    .eq("user_id", ctx.userId)
    .eq("batch_id", batchId)
    .limit(500);
  if (error) throw new Error(`batch words read failed: ${error.message}`);

  return { words: data ?? [] };
}

/** One incoming word array → dictionary drafts, deduplicated. */
function parseWordDrafts(raw: unknown): DictionaryEntryDraft[] {
  const rawWords = Array.isArray(raw) ? raw.slice(0, 200) : [];
  const parsed: DictionaryEntryDraft[] = rawWords
    .filter((w): w is Record<string, unknown> => typeof w === "object" && w !== null)
    .map((w) => {
      const headword = String(w.headword ?? "").trim().slice(0, 200);
      const lemma = String(w.lemma ?? "").trim() || headword.replace(/^(der|die|das)\s+/i, "");
      const cefr = String(w.cefr ?? "").trim().toUpperCase();
      const forms: Record<string, string> = {};
      if (typeof w.forms === "object" && w.forms !== null) {
        for (const [k, v] of Object.entries(w.forms as Record<string, unknown>)) {
          const value = String(v ?? "").trim();
          if (value) forms[k.slice(0, 30)] = value.slice(0, 120);
        }
      }
      // Agents slip a plural onto a verb exactly as the photo reader does, so
      // the same rule applies to what comes in over MCP.
      return applyNounFieldRules({
        headword,
        lemma,
        translation: String(w.translation ?? "").trim().slice(0, 400),
        partOfSpeech: String(w.part_of_speech ?? "").trim().slice(0, 60),
        gender: String(w.gender ?? "").trim().toLowerCase().slice(0, 4),
        article: String(w.article ?? "").trim().slice(0, 20),
        plural: String(w.plural ?? "").trim().slice(0, 120),
        forms,
        cefr: LEVELS.includes(cefr as CefrLevel) ? cefr : "",
        note: String(w.note ?? "").trim().slice(0, 300),
        example: String(w.example ?? "").trim().slice(0, 400),
        exampleTranslation: String(w.example_translation ?? "").trim().slice(0, 400),
      });
    })
    .filter((d) => d.headword && d.translation);

  return dedupeDictionaryDrafts(parsed);
}

async function addWordsToBatch(ctx: Ctx, args: Args): Promise<unknown> {
  const batchId = String(args.batch_id ?? "").trim();
  if (!batchId) throw new Error("Pass 'batch_id' from list_word_batches.");

  const { data: batch, error: readError } = await ctx.admin
    .from("dictionary_batches")
    .select("id, title, language, word_count")
    .eq("id", batchId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (readError) throw new Error(`batch read failed: ${readError.message}`);
  if (!batch) throw new Error("No such batch in this learner's dictionary.");

  const drafts = parseWordDrafts(args.words);
  if (drafts.length === 0) {
    throw new Error("Every word needs at least 'headword' and 'translation'.");
  }

  const language = String(batch.language ?? "") || (await getLanguages(ctx)).target;
  const title = String(batch.title ?? "");

  const saved = await saveDictionaryEntries(ctx.admin, ctx.userId, language, drafts, title, batchId);
  if (!saved.ok) throw new Error(saved.error);

  const cards = await createCardsForEntries(ctx.admin, ctx.userId, drafts, batchId, title);
  if (!cards.ok) throw new Error(cards.error);

  const { count } = await ctx.admin
    .from("dictionary_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .eq("batch_id", batchId);
  if (typeof count === "number") {
    await ctx.admin.from("dictionary_batches").update({ word_count: count }).eq("id", batchId);
  }

  return {
    batch_id: batchId,
    title,
    words_added: saved.added,
    words_updated: saved.updated,
    cards_created: cards.created,
    cards_relinked: cards.relinked,
    note: "Words already in the dictionary were updated rather than duplicated, and cards that already existed kept their review history.",
  };
}

async function addWordBatch(ctx: Ctx, args: Args): Promise<unknown> {
  const title = String(args.title ?? "").trim().slice(0, 200);
  const drafts = parseWordDrafts(args.words);
  if (!title) {
    throw new Error("A batch needs a 'title' — what the learner will see on the page in their Словарь.");
  }
  if (drafts.length === 0) {
    throw new Error("A batch needs a non-empty 'words' array, and every word needs at least 'headword' and 'translation'.");
  }

  const langs = await getLanguages(ctx);
  const language = typeof args.language === "string" && args.language.trim()
    ? args.language.trim()
    : langs.target;

  const { data: batch, error } = await ctx.admin
    .from("dictionary_batches")
    .insert({
      user_id: ctx.userId,
      title,
      kind: String(args.source ?? "от ИИ-ассистента").slice(0, 120),
      topic: String(args.topic ?? "").trim().slice(0, 80),
      language,
      word_count: drafts.length,
    })
    .select("id")
    .single();
  if (error || !batch) throw new Error(`batch insert failed: ${error?.message ?? "no row"}`);

  const saved = await saveDictionaryEntries(ctx.admin, ctx.userId, language, drafts, title, batch.id as string);
  if (!saved.ok) {
    const cleanupError = await discardDictionaryBatch(ctx.admin, ctx.userId, batch.id as string);
    throw new Error(cleanupError ? `${saved.error}; batch cleanup failed: ${cleanupError}` : saved.error);
  }

  const cards = await createCardsForEntries(ctx.admin, ctx.userId, drafts, batch.id as string, title);
  if (!cards.ok) {
    const cleanupError = await discardDictionaryBatch(ctx.admin, ctx.userId, batch.id as string);
    throw new Error(cleanupError ? `${cards.error}; batch cleanup failed: ${cleanupError}` : cards.error);
  }

  return {
    batch_id: batch.id,
    title,
    words: drafts.length,
    cards_created: cards.created,
    cards_relinked: cards.relinked,
    note: "The batch appears in the learner's Словарь as its own page, with its own progress and a «тренировать» button; every new word is already a flashcard. Words that were already cards kept the review history they had.",
  };
}

// ─── How the learning is actually going ─────────────────────────────────────

async function getProgress(ctx: Ctx, args: Args): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 200);
  const [cards, variants] = await Promise.all([getCards(ctx), getVariantProgress(ctx)]);
  const now = Date.now();

  const withStats = cards.map((c) => {
    const reps = c.repetitions ?? 0;
    const lapses = c.lapses ?? 0;
    return {
      word: c.front,
      meaning: c.back.split("\n")[0],
      level: c.cefr ?? "",
      reps,
      lapses,
      ease: c.easiness_factor ?? 2.5,
      interval_days: c.interval_days ?? 0,
      due_in_days: c.next_review_at
        ? Math.round((new Date(c.next_review_at).getTime() - now) / 86400000)
        : 0,
      source: c.source_book_title ?? "",
    };
  });

  // "Struggling" is not a low score, it is a word that keeps being forgotten:
  // lapses despite repetitions, or an ease factor the algorithm has pushed down.
  const struggling = withStats
    .filter((w) => w.lapses >= 2 || (w.lapses >= 1 && w.ease <= 2.2))
    .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease)
    .slice(0, limit);

  const confident = withStats
    .filter((w) => w.reps >= LEARNED_REPETITIONS && w.lapses === 0)
    .sort((a, b) => b.interval_days - a.interval_days)
    .slice(0, limit);

  const learning = withStats
    .filter((w) => w.reps > 0 && w.reps < LEARNED_REPETITIONS)
    .slice(0, limit);

  const untouched = withStats.filter((w) => w.reps === 0);

  return {
    totals: {
      cards: cards.length,
      never_studied: untouched.length,
      in_progress: withStats.filter((w) => w.reps > 0 && w.reps < LEARNED_REPETITIONS).length,
      confident: withStats.filter((w) => w.reps >= LEARNED_REPETITIONS && w.lapses === 0).length,
      struggling: withStats.filter((w) => w.lapses >= 2 || (w.lapses >= 1 && w.ease <= 2.2)).length,
      due_now: cards.filter(isDue).length,
    },
    by_level: ["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => ({
      level,
      total: withStats.filter((w) => w.level === level).length,
      confident: withStats.filter((w) => w.level === level && w.reps >= LEARNED_REPETITIONS && w.lapses === 0).length,
    })).filter((row) => row.total > 0),
    // The same word is scheduled separately in each direction, so "knowing" it
    // is not one number: a learner who reads a word fluently may still be
    // unable to produce it from the Russian.
    by_direction: (["forward", "reverse", "audio"] as const).map((variant) => {
      const rows = variant === "forward"
        ? cards.map((c) => ({ reps: c.repetitions ?? 0, lapses: c.lapses ?? 0, due: isDue(c) }))
        : variants
            .filter((v) => v.variant === variant)
            .map((v) => ({
              reps: v.repetitions ?? 0,
              lapses: v.lapses ?? 0,
              due: !v.next_review_at || new Date(v.next_review_at).getTime() <= now,
            }));
      return {
        direction: variant,
        means: SKILL_NAMES[variant],
        started: rows.filter((r) => r.reps > 0).length,
        confident: rows.filter((r) => r.reps >= LEARNED_REPETITIONS && r.lapses === 0).length,
        due_now: rows.filter((r) => r.due).length,
        not_started: cards.length - rows.filter((r) => r.reps > 0).length,
      };
    }),
    struggling,
    confident,
    learning,
    how_to_use:
      "Practise new grammar with the 'confident' words so the sentence is about the construction, not the vocabulary. Weave 'struggling' words into examples and stories as often as you can — those are the ones being forgotten. Leave 'never studied' words alone unless the learner asks. If 'reverse' is far behind 'forward', the learner recognises words they cannot yet produce — ask them to say things, not just read them.",
  };
}

// ─── Ready-made texts the learner could read next ───────────────────────────

async function listCatalogue(ctx: Ctx, args: Args): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 60);
  const level = String(args.level ?? "").trim().toUpperCase();
  const langs = await getLanguages(ctx);
  const language = typeof args.language === "string" && args.language.trim()
    ? args.language.trim()
    : langs.target;

  let request = ctx.admin
    .from("shared_books")
    .select("id, title, author, cefr_level, language, course_title, total_chars, metadata")
    .is("owner_user_id", null)
    .eq("language", language)
    .limit(limit * 3);
  if (LEVELS.includes(level as CefrLevel)) request = request.eq("cefr_level", level);

  const [{ data: books, error }, cards] = await Promise.all([request, getCards(ctx)]);
  if (error) throw new Error(`catalogue read failed: ${error.message}`);

  const known = buildKnownWordSet(cards.map((c) => c.front));

  // Texts imported before coverage existed carry no frequency data, and the
  // backfill behind it is an owner-only button in the app. Rather than reporting
  // an empty percentage — which reads as "this text has nothing in common with
  // what you know" — count the words here, from the text itself.
  const missing = (books ?? [])
    .filter((b) => !((b.metadata ?? {}) as Record<string, unknown>).token_total)
    .slice(0, COUNTED_ON_THE_FLY)
    .map((b) => b.id as string);

  const countedNow = new Map<string, ReturnType<typeof buildWordCounts>>();
  if (missing.length > 0) {
    const { data: chapters } = await ctx.admin
      .from("shared_book_chapters")
      .select("shared_book_id, plain_text")
      .in("shared_book_id", missing);
    const textById = new Map<string, string>();
    for (const chapter of chapters ?? []) {
      const id = chapter.shared_book_id as string;
      const text = String(chapter.plain_text ?? "");
      textById.set(id, `${textById.get(id) ?? ""} ${text}`);
    }
    for (const [id, text] of textById) {
      if (text.trim()) countedNow.set(id, buildWordCounts(text));
    }
  }

  const texts = (books ?? []).map((b) => {
    const meta = (b.metadata ?? {}) as Record<string, unknown>;
    const fresh = countedNow.get(b.id as string);
    const coverage = computeCoverage(
      fresh ?? {
        wordCounts: (meta.word_counts ?? null) as Record<string, number> | null,
        tokenTotal: (meta.token_total ?? null) as number | null,
      },
      known,
    );
    return {
      id: b.id,
      title: b.title,
      level: b.cefr_level,
      course: b.course_title,
      characters: b.total_chars,
      // How much of it the learner can already read — the same badge the app
      // shows on the catalogue card.
      known_words_percent: coverage ? Math.round(coverage.ratio * 100) : null,
      comfortable: coverage?.isComfortable ?? null,
    };
  });

  // A text worth suggesting is one the learner almost understands: mostly known
  // words with enough new ones to be worth reading.
  texts.sort((a, b) => {
    if (a.comfortable !== b.comfortable) return a.comfortable ? -1 : 1;
    return (b.known_words_percent ?? 0) - (a.known_words_percent ?? 0);
  });

  const unmeasured = texts.filter((t) => t.known_words_percent === null).length;

  return {
    texts: texts.slice(0, limit),
    note: "Public texts in the app's catalogue («Обзор»). 'comfortable' means the learner already knows 90–98% of the words — the band where reading teaches most. Open one with get_text.",
    ...(unmeasured > 0
      ? {
          warning: `${unmeasured} of these texts could not be measured — their stored text is empty, so 'known_words_percent' is null for them. Judge those by CEFR level instead.`,
        }
      : {}),
  };
}

// ─── Registry ────────────────────────────────────────────────────────────────
//
// Order matters: a model skimming tools/list reads the top of the list most
// carefully, so the two tools that explain the app come first, then reading,
// then writing.

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "get_overview",
    title: "Что сейчас в приложении",
    description:
      "What is in the learner's aibook right now: target/native language, flashcard counts (total, due, learned), dictionary size and recent word batches, recent lessons, reading progress. Call this first — it also lists what else you can do here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "Что сейчас в приложении" },
  },
  {
    name: "get_capabilities",
    title: "Что этот сервер умеет",
    description:
      "The full map of this connection: every area of the app, which tools belong to it, what the learner typically says to mean it, and what this connection deliberately cannot do. Call it when you are unsure whether aibook can do something the learner asked for.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "Что этот сервер умеет" },
  },
  {
    name: "get_progress",
    title: "Как идёт учёба",
    description:
      "How the learning is actually going, from the spaced-repetition record: which words the learner knows confidently, which are in progress, and which they keep forgetting (repeated lapses or an ease factor the algorithm has pushed down), with totals by CEFR level and by training direction (recognition / recall / listening — each word is scheduled separately in each). Use the confident words when practising a new construction — the sentence should test the grammar, not the vocabulary — and work the struggling ones into examples and stories.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Words per list (default 40, max 200)" } },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Как идёт учёба" },
  },
  {
    name: "get_study_words",
    title: "Мои слова списком",
    description:
      "The learner's vocabulary split into 'learned' (3+ successful reviews) and 'still_learning' — a plain word list, when you only need to know what they know. get_progress says the same thing in more detail.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max words per list (default 200, max 500)" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Мои слова списком" },
  },
  {
    name: "list_flashcards",
    title: "Карточки",
    description:
      "List the learner's flashcards with their scheduling state and ids. Filter by 'due', 'learned', 'new' or 'struggling', narrow to one dictionary batch, or search the text of the cards. The ids are what update_flashcard and delete_flashcards take.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "due", "learned", "new", "struggling"],
          description: "Default 'all'. 'struggling' = repeatedly forgotten.",
        },
        search: { type: "string", description: "Substring of the front or back text" },
        batch_id: { type: "string", description: "Only cards from this dictionary batch (see list_word_batches)" },
        limit: { type: "number", description: "Default 100, max 500" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Карточки" },
  },
  {
    name: "list_word_batches",
    title: "Пачки слов",
    description:
      "The learner's vocabulary batches («пачки»). A batch is one page of vocabulary — usually photographed from their coursebook — kept together as the unit they were set to learn, with its own progress and its own «тренировать» button in the app. Call this to see what their course has covered and how far along each page is.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "Пачки слов" },
  },
  {
    name: "list_batch_words",
    title: "Слова одной пачки",
    description: "Every word of one batch, with article, plural, verb forms, translation, example and CEFR level.",
    inputSchema: {
      type: "object",
      properties: { batch_id: { type: "string", description: "From list_word_batches" } },
      required: ["batch_id"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Слова одной пачки" },
  },
  {
    name: "search_dictionary",
    title: "Поиск по словарю",
    description:
      "Search the learner's whole dictionary — their own words as a dictionary would print them (article, plural, verb forms, CEFR, example). Search by text, or filter by batch, CEFR level or part of speech. Use it to check whether a word is already theirs before teaching it as new, or to recall exactly how they wrote it down.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Matches headword, lemma, translation or example" },
        batch_id: { type: "string", description: "Only this batch" },
        level: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"] },
        part_of_speech: { type: "string", description: "As written in the learner's language, e.g. «глагол»" },
        limit: { type: "number", description: "Default 50, max 300" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Поиск по словарю" },
  },
  {
    name: "list_texts",
    title: "Мои уроки",
    description: "List the learner's own lessons («Мои уроки») with reading progress.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 30, max 100" } },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Мои уроки" },
  },
  {
    name: "get_text",
    title: "Прочитать текст",
    description: "Read the full paragraphs of one text by id — e.g. to discuss it with the learner or quiz them on it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Text id from list_texts, list_catalogue or get_overview" } },
      required: ["id"],
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Прочитать текст" },
  },
  {
    name: "list_catalogue",
    title: "Что почитать",
    description:
      "The ready-made public texts in the app's catalogue, with the share of words the learner already knows in each and whether it sits in the comfortable 90–98% band. Use it to answer «что мне почитать?» with something from the app instead of writing a new text.",
    inputSchema: {
      type: "object",
      properties: {
        level: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"], description: "Only texts at this level" },
        language: { type: "string", description: "ISO code; defaults to the learner's target language" },
        limit: { type: "number", description: "Default 20, max 60" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "Что почитать" },
  },
  {
    name: "add_flashcards",
    title: "Добавить карточки",
    description:
      "Add flashcards to the learner's spaced-repetition deck. 'front' is the word/phrase in the language being learned, 'back' is the translation into the learner's native language. Duplicates (same front) are skipped automatically. This is for a few loose words; a themed set belongs in add_word_batch.",
    inputSchema: {
      type: "object",
      properties: {
        cards: {
          type: "array",
          description: "Up to 100 cards",
          items: {
            type: "object",
            properties: {
              front: { type: "string", description: "Target-language word/phrase, e.g. 'die Verabredung'" },
              back: { type: "string", description: "Translation in the learner's native language" },
              type: { type: "string", enum: ["word", "phrase", "sentence"], description: "Default 'word'" },
            },
            required: ["front", "back"],
          },
        },
        source: { type: "string", description: "Where these came from, shown on the card (default 'Из чата с ИИ')" },
      },
      required: ["cards"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, title: "Добавить карточки" },
  },
  {
    name: "add_word_batch",
    title: "Новая пачка слов",
    description:
      "Create a new vocabulary batch — the right tool when a lesson with the learner produced a set of words that belong together (\"сохрани слова по сегодняшней теме\"). It appears in their Словарь as one page with its own progress and a «тренировать» button, and every word becomes a flashcard immediately. Fill in as much of each word as you know (article, plural, verb forms, example): that is what the learner sees when they open the entry. Use add_flashcards instead for a few loose words that are not a themed set.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "What this set is, in the learner's native language — e.g. «Транспорт · из чата»" },
        topic: { type: "string", description: "Two or three words naming the theme" },
        language: { type: "string", description: "ISO code; defaults to the learner's target language" },
        source: { type: "string", description: "Where the words came from; shown under the title" },
        words: {
          type: "array",
          description: "Up to 200 words",
          items: {
            type: "object",
            properties: {
              headword: { type: "string", description: "As a dictionary prints it — nouns with their article: «die Haltestelle»" },
              lemma: { type: "string", description: "Base form without the article" },
              translation: { type: "string", description: "Into the learner's native language" },
              part_of_speech: { type: "string", description: "In the learner's language: «существительное», «глагол», …" },
              gender: { type: "string", description: "m / f / n / pl for nouns" },
              article: { type: "string" },
              plural: { type: "string", description: "Written out in full: «die Haltestellen»" },
              forms: { type: "object", description: "Irregular verb parts: praeteritum, partizip2, hilfsverb, trennbar" },
              cefr: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"] },
              note: { type: "string", description: "One short warning if the word has a trap (a case, a false friend)" },
              example: { type: "string" },
              example_translation: { type: "string" },
            },
            required: ["headword", "translation"],
          },
        },
      },
      required: ["title", "words"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, title: "Новая пачка слов" },
  },
  {
    name: "add_words_to_batch",
    title: "Дополнить пачку",
    description:
      "Add words to a batch that already exists («добавь ещё слов в ту пачку»). Words already in the dictionary are updated rather than duplicated, and words that are already flashcards keep the review history they have. Same word fields as add_word_batch.",
    inputSchema: {
      type: "object",
      properties: {
        batch_id: { type: "string", description: "From list_word_batches" },
        words: {
          type: "array",
          description: "Up to 200 words, same shape as in add_word_batch",
          items: {
            type: "object",
            properties: {
              headword: { type: "string" },
              lemma: { type: "string" },
              translation: { type: "string" },
              part_of_speech: { type: "string" },
              gender: { type: "string" },
              article: { type: "string" },
              plural: { type: "string" },
              forms: { type: "object" },
              cefr: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"] },
              note: { type: "string" },
              example: { type: "string" },
              example_translation: { type: "string" },
            },
            required: ["headword", "translation"],
          },
        },
      },
      required: ["batch_id", "words"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, title: "Дополнить пачку" },
  },
  {
    name: "create_lesson",
    title: "Сохранить текст в «Мои уроки»",
    description:
      "Save a reading text you wrote into the learner's «Мои уроки». Write the text yourself in the target language (use get_progress or get_study_words to match their vocabulary), then pass it here. Optionally include a vocabulary list and comprehension questions — the app renders them after the text, and the learner can read it aloud, translate it or discuss it inside the app.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title in the target language" },
        description: { type: "string", description: "One sentence in the learner's native language about the text" },
        paragraphs: {
          type: "array", items: { type: "string" },
          description: "The text itself, one paragraph per entry, target language only, no markdown",
        },
        vocabulary: {
          type: "array",
          items: {
            type: "object",
            properties: { term: { type: "string" }, translation: { type: "string" } },
            required: ["term"],
          },
          description: "Optional glossary: new words with native-language translations",
        },
        questions: { type: "array", items: { type: "string" }, description: "Optional comprehension questions in the target language" },
        level: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"], description: "CEFR level you wrote at; measured from the text if omitted" },
        target_language: { type: "string", description: "ISO code; defaults to the learner's target language" },
      },
      required: ["title", "paragraphs"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, title: "Сохранить текст в «Мои уроки»" },
  },
  {
    name: "update_flashcard",
    title: "Исправить карточку",
    description:
      "Fix the text of one existing card — a wrong translation, a missing article, the CEFR level. The review schedule is left untouched, so correcting a card costs the learner nothing. Identify the card by 'id' from list_flashcards, or by 'front_match' if you know its exact front text.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Card id from list_flashcards" },
        front_match: { type: "string", description: "Exact front text, if you do not have the id" },
        front: { type: "string", description: "New front (target language)" },
        back: { type: "string", description: "New back (native language)" },
        level: { type: "string", enum: ["A1", "A2", "B1", "B2", "C1", "C2"] },
      },
      additionalProperties: false,
    },
    annotations: { ...WRITES, idempotentHint: true, title: "Исправить карточку" },
  },
  {
    name: "delete_flashcards",
    title: "Удалить карточки",
    description:
      "Delete cards from the deck, by id, up to 50 at a time. Deleting throws away that card's review history, so use it for cleaning up mistakes (duplicates, cards you added wrongly) and ask the learner first otherwise. The dictionary entries the cards came from are left in place.",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Card ids from list_flashcards" },
      },
      required: ["ids"],
      additionalProperties: false,
    },
    annotations: { ...DESTRUCTIVE, idempotentHint: true, title: "Удалить карточки" },
  },
];

const HANDLERS: Record<string, (ctx: Ctx, args: Args) => Promise<unknown>> = {
  get_overview: (ctx) => getOverview(ctx),
  get_capabilities: async () => getCapabilities(),
  get_progress: getProgress,
  get_study_words: getStudyWords,
  list_flashcards: listFlashcards,
  list_word_batches: (ctx) => listBatches(ctx),
  list_batch_words: listBatchWords,
  search_dictionary: searchDictionary,
  list_texts: listTexts,
  get_text: getText,
  list_catalogue: listCatalogue,
  add_flashcards: addFlashcards,
  add_word_batch: addWordBatch,
  add_words_to_batch: addWordsToBatch,
  create_lesson: createLesson,
  update_flashcard: updateFlashcard,
  delete_flashcards: deleteFlashcards,
};

/** Every tool that is advertised must be callable, and vice versa. */
export function findRegistryDrift(): string[] {
  const problems: string[] = [];
  for (const tool of MCP_TOOLS) {
    if (!HANDLERS[tool.name]) problems.push(`advertised but not implemented: ${tool.name}`);
  }
  for (const name of Object.keys(HANDLERS)) {
    if (!MCP_TOOLS.some((t) => t.name === name)) problems.push(`implemented but not advertised: ${name}`);
  }
  for (const area of CAPABILITY_AREAS) {
    for (const name of area.tools) {
      if (!MCP_TOOLS.some((t) => t.name === name)) {
        problems.push(`named in capabilities but not a tool: ${name}`);
      }
    }
  }
  for (const tool of MCP_TOOLS) {
    if (!CAPABILITY_AREAS.some((a) => a.tools.includes(tool.name))) {
      problems.push(`tool missing from the capability map: ${tool.name}`);
    }
  }
  return problems;
}

/** The same map as get_capabilities, as a document for clients that read resources. */
export function buildGuideMarkdown(): string {
  const areas = CAPABILITY_AREAS.map((area) => {
    const tools = area.tools
      .map((name) => {
        const tool = MCP_TOOLS.find((t) => t.name === name);
        return `- \`${name}\` — ${tool?.description ?? ""}`;
      })
      .join("\n");
    return `## ${area.area}\n\n${area.summary}\n\nThe learner says: ${area.say.join(", ")}\n\n${tools}`;
  }).join("\n\n");

  return `# aibook

A language-learning app: reading texts, a personal dictionary kept in batches, and a spaced-repetition deck. This connection belongs to one learner. You are the teacher on the other end of it — you write the texts and choose the words, and these tools put them into their app.

${areas}

## Worth knowing

${AGENT_TIPS.map((t) => `- ${t}`).join("\n")}

## Not available through this connection

${AGENT_LIMITS.map((l) => `- ${l}`).join("\n")}
`;
}

export async function callMcpTool(
  admin: SupabaseClient,
  userId: string,
  name: string,
  args: Args,
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) {
    throw new Error(`Unknown tool: ${name}. Available: ${MCP_TOOLS.map((t) => t.name).join(", ")}.`);
  }
  return handler({ admin, userId }, args);
}
