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
import { estimateLevel } from "@/lib/text/readability";
import type { GeneratedLesson } from "@/lib/ai/buildLessonPrompt";
import type { CefrLevel } from "@/lib/types";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];
const CARD_TYPES = ["word", "phrase", "sentence"] as const;

export type McpToolDef = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

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
  next_review_at: string | null;
  source_book_title: string | null;
};

async function getCards(ctx: Ctx): Promise<CardRow[]> {
  const { data, error } = await ctx.admin
    .from("flashcards")
    .select("id, front, back, status, repetitions, next_review_at, source_book_title")
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

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function getOverview(ctx: Ctx): Promise<unknown> {
  const [langs, cards, lessons, lessonCount, progress] = await Promise.all([
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
  ]);

  const progressRows = progress.data ?? [];
  return {
    app: "aibook — language-learning reader (texts, lessons, SRS flashcards)",
    target_language: langs.target,
    native_language: langs.native,
    flashcards: {
      total: cards.length,
      due_now: cards.filter(isDue).length,
      learned: cards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS).length,
      note: `learned = ${LEARNED_REPETITIONS}+ successful reviews in a row`,
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

async function listFlashcards(ctx: Ctx, args: Args): Promise<unknown> {
  const filter = args.filter === "due" || args.filter === "learned" ? args.filter : "all";
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);

  let cards = await getCards(ctx);
  if (filter === "due") cards = cards.filter(isDue);
  if (filter === "learned") cards = cards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS);

  return {
    total: cards.length,
    returned: Math.min(cards.length, limit),
    cards: cards.slice(0, limit).map((c) => ({
      front: c.front,
      back: c.back,
      status: c.status ?? "new",
      repetitions: c.repetitions ?? 0,
      next_review_at: c.next_review_at,
      source: c.source_book_title,
    })),
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

// ─── Registry ────────────────────────────────────────────────────────────────

export const MCP_TOOLS: McpToolDef[] = [
  {
    name: "get_overview",
    description:
      "What is in the learner's aibook right now: target/native language, flashcard counts (total, due, learned), recent lessons, reading progress. Call this first to understand the learner's state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_study_words",
    description:
      "The learner's vocabulary split into 'learned' (3+ successful reviews) and 'still_learning'. Use it to write stories/texts the learner can actually read, or to avoid adding duplicate cards.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max words per list (default 200, max 500)" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_flashcards",
    description: "List the learner's flashcards with SRS state (front, back, status, repetitions, next review).",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all", "due", "learned"], description: "Default 'all'" },
        limit: { type: "number", description: "Default 100, max 500" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "add_flashcards",
    description:
      "Add flashcards to the learner's spaced-repetition deck. 'front' is the word/phrase in the language being learned, 'back' is the translation into the learner's native language. Duplicates (same front) are skipped automatically.",
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
  },
  {
    name: "create_lesson",
    description:
      "Save a reading text you wrote into the learner's «Мои уроки». Write the text yourself in the target language (use get_study_words to match their vocabulary), then pass it here. Optionally include a vocabulary list and comprehension questions — the app renders them after the text.",
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
  },
  {
    name: "list_texts",
    description: "List the learner's own lessons («Мои уроки») with reading progress.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 30, max 100" } },
      additionalProperties: false,
    },
  },
  {
    name: "get_text",
    description: "Read the full paragraphs of one text by id — e.g. to discuss it with the learner or quiz them on it.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Text id from list_texts / get_overview" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

const HANDLERS: Record<string, (ctx: Ctx, args: Args) => Promise<unknown>> = {
  get_overview: (ctx) => getOverview(ctx),
  get_study_words: getStudyWords,
  list_flashcards: listFlashcards,
  add_flashcards: addFlashcards,
  create_lesson: createLesson,
  list_texts: listTexts,
  get_text: getText,
};

export async function callMcpTool(
  admin: SupabaseClient,
  userId: string,
  name: string,
  args: Args,
): Promise<unknown> {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown tool: ${name}`);
  return handler({ admin, userId }, args);
}
