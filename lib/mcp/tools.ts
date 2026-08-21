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
  adoptCardsIntoPack,
  createCardsForEntries,
  dedupeDictionaryDrafts,
  discardDictionaryBatch,
  findOrCreatePack,
  PACK_DESCRIPTION_LIMIT,
  PACK_INSTRUCTION_LIMIT,
  readBatches,
  saveDictionaryEntries,
} from "@/lib/db/dictionaryStore";
import { describePackTraining, normalizePackTraining } from "@/lib/cards";
import { applyNounFieldRules, type DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";
import { estimateLevel } from "@/lib/text/readability";
import { buildKnownWordSet, buildWordCounts, computeCoverage } from "@/lib/text/vocab";
import type { GeneratedLesson } from "@/lib/ai/buildLessonPrompt";
import type { CefrLevel } from "@/lib/types";
import { AGENT_LIMITS, AGENT_TIPS, CAPABILITY_AREAS } from "@/lib/mcp/capabilities";

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * What a pack is, and what it was built to.
 *
 * A title alone does not survive a month: the learner comes back to a shelf of
 * German noun packs and cannot tell which one was «аккузатив, только мужской
 * род, одно прилагательное». The brief that produced the pack is the only
 * thing that does tell them apart, so every tool that can make a pack takes it.
 */
function packDetails(args: Args): { description: string; instruction: string } {
  return {
    description: String(args.description ?? "").trim().slice(0, PACK_DESCRIPTION_LIMIT),
    instruction: String(args.instruction ?? "").trim().slice(0, PACK_INSTRUCTION_LIMIT),
  };
}
const CARD_TYPES = ["word", "phrase", "sentence"] as const;

// How many catalogue texts may be word-counted inside one call when their
// stored frequency data is missing. Enough to fill a page of suggestions,
// small enough that the request still finishes inside the function's budget.
const COUNTED_ON_THE_FLY = 30;

// The shelves the app's «Обзор» tab is divided into, as stored on the row.
const CATALOGUE_SHELVES = ["klexikon", "universal_cefr", "oersi", "dw", "generated"] as const;
type CatalogueShelf = typeof CATALOGUE_SHELVES[number];

// How many catalogue rows are considered before ranking by coverage. Each row
// carries a word-frequency map, so this is the ceiling that keeps the call
// inside its budget; the tool says so when it hits it.
const CATALOGUE_CANDIDATES = 200;

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
  last_reviewed_at: string | null;
  source_book_id: string | null;
  source_book_title: string | null;
  selection_type: string | null;
  cefr: string | null;
};

const CARD_COLUMNS =
  "id, front, back, status, repetitions, lapses, easiness_factor, interval_days, next_review_at, last_reviewed_at, source_book_id, source_book_title, selection_type, cefr";

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

// An interval past three weeks means the word has settled — Anki's convention,
// and the one the app's statistics panel counts as «выучено».
const MATURE_INTERVAL_DAYS = 21;
const FORECAST_DAYS = 7;
const DAY_MS = 86400000;
const WEEKDAYS_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * The app schedules by day, not by minute: everything falling due before
 * midnight is in today's session, which is why its «сегодня» number is larger
 * than a naive `next_review_at <= now` count. Reporting the smaller number told
 * agents there was less to do than the learner could see on their own screen.
 *
 * Day boundaries are UTC here, because a server has no way to know which
 * midnight the learner is living in.
 */
function endOfTodayMs(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + DAY_MS - 1;
}

// The three directions a card is trained in. "forward" lives on the flashcard
// row itself; the other two have their own schedules in a side table, so a word
// can be firm one way round and unlearned the other.
type VariantRow = {
  flashcard_id: string;
  variant: "reverse" | "audio";
  status: string | null;
  repetitions: number | null;
  lapses: number | null;
  easiness_factor: number | null;
  interval_days: number | null;
  next_review_at: string | null;
  last_reviewed_at: string | null;
};

type Direction = "forward" | "reverse" | "audio";
const DIRECTIONS: Direction[] = ["forward", "reverse", "audio"];

const SKILL_NAMES: Record<Direction, string> = {
  forward: "recognition (sees the target word, recalls the meaning)",
  reverse: "recall (sees the meaning, produces the target word)",
  audio: "listening (hears the word)",
};

async function getVariantProgress(ctx: Ctx): Promise<VariantRow[]> {
  const { data, error } = await ctx.admin
    .from("flashcard_variant_progress")
    .select(
      "flashcard_id, variant, status, repetitions, lapses, easiness_factor, interval_days, next_review_at, last_reviewed_at",
    )
    .eq("user_id", ctx.userId);
  // The table arrived in a later migration; an installation without it should
  // still answer everything else rather than failing the whole call.
  if (error) return [];
  return (data ?? []) as VariantRow[];
}

// ─── One schedule, whichever direction it belongs to ────────────────────────
//
// The app treats the three directions as one deck of prompts: a card is due if
// any direction is due, and a session is counted in prompts, not in words.
// These helpers mirror lib/cards.ts exactly so the numbers an agent quotes are
// the numbers on the learner's screen.

export type DirectionProgress = {
  cardId: string;
  direction: Direction;
  status: string;
  repetitions: number;
  lapses: number;
  ease: number;
  intervalDays: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
};

/** Every card in every direction, unscheduled directions included. */
export function directionProgress(cards: CardRow[], variants: VariantRow[]): DirectionProgress[] {
  const byCard = new Map<string, Map<Direction, VariantRow>>();
  for (const row of variants) {
    const forCard = byCard.get(row.flashcard_id) ?? new Map<Direction, VariantRow>();
    forCard.set(row.variant, row);
    byCard.set(row.flashcard_id, forCard);
  }

  const out: DirectionProgress[] = [];
  for (const card of cards) {
    for (const direction of DIRECTIONS) {
      if (direction === "forward") {
        out.push({
          cardId: card.id,
          direction,
          status: card.status ?? "new",
          repetitions: card.repetitions ?? 0,
          lapses: card.lapses ?? 0,
          ease: card.easiness_factor ?? 2.5,
          intervalDays: card.interval_days ?? 0,
          dueAt: card.next_review_at,
          lastReviewedAt: card.last_reviewed_at,
        });
        continue;
      }
      const row = byCard.get(card.id)?.get(direction);
      out.push({
        cardId: card.id,
        direction,
        // A direction the learner has never been asked in is new, and new is due.
        status: row?.status ?? "new",
        repetitions: row?.repetitions ?? 0,
        lapses: row?.lapses ?? 0,
        ease: row?.easiness_factor ?? 2.5,
        intervalDays: row?.interval_days ?? 0,
        dueAt: row?.next_review_at ?? null,
        lastReviewedAt: row?.last_reviewed_at ?? null,
      });
    }
  }
  return out;
}

export function isDueToday(p: DirectionProgress, todayEndMs: number): boolean {
  if (p.status === "new") return true;
  if (!p.dueAt) return true;
  const due = Date.parse(p.dueAt);
  return !Number.isFinite(due) || due <= todayEndMs;
}

/**
 * "Struggling" is not a low score: it is a prompt the learner keeps losing —
 * forgotten twice, or ground down to an ease factor the algorithm has pushed
 * to the floor. Same rule as the app's «Сложные» filter (isHardProgress).
 */
export function isStrugglingProgress(p: { lapses: number; repetitions: number; ease: number }): boolean {
  return p.lapses >= 2 || (p.repetitions > 0 && p.ease <= 2.2);
}

/**
 * The statistics panel of the app, computed from the same rows over MCP.
 *
 * Written as a pure function of the two tables so it can be tested without a
 * database, and so `get_overview` and `get_progress` can never disagree.
 */
export function summarizeDeck(cards: CardRow[], variants: VariantRow[], now = new Date()) {
  const todayEndMs = endOfTodayMs(now);
  const progress = directionProgress(cards, variants);

  const startOfTodayMs = endOfTodayMs(now) - DAY_MS + 1;
  const dueCards = new Set<string>();
  const overdueCards = new Set<string>();
  const dueByDirection: Record<Direction, number> = { forward: 0, reverse: 0, audio: 0 };
  // Starts at today, not tomorrow: an agent asked "what is coming up" needs the
  // day the learner is actually standing in, and each entry carries its date so
  // a weekday can never be mistaken for the one that just passed.
  const forecast = Array.from({ length: FORECAST_DAYS }, (_, i) => {
    const date = new Date(startOfTodayMs + i * DAY_MS);
    return {
      in_days: i,
      date: date.toISOString().slice(0, 10),
      weekday: WEEKDAYS_EN[date.getUTCDay()],
      repetitions: 0,
      reviewed: 0,
    };
  });
  const hardCards = new Set<string>();
  const reviewDays = new Set<string>();
  const dayKey = (value: string | null): string | null => {
    if (!value) return null;
    const time = Date.parse(value);
    if (!Number.isFinite(time)) return null;
    return new Date(time).toISOString().slice(0, 10);
  };
  const todayKey = new Date(now).toISOString().slice(0, 10);

  let dueReps = 0;
  let overdueReps = 0;
  let started = 0;
  let reviewedToday = 0;

  for (const p of progress) {
    if (p.repetitions > 0) started += 1;
    if (isStrugglingProgress(p)) hardCards.add(p.cardId);
    if (isDueToday(p, todayEndMs)) {
      dueCards.add(p.cardId);
      dueByDirection[p.direction] += 1;
      dueReps += 1;
      forecast[0].repetitions += 1;
      // A card that was scheduled for an earlier day and not done is late; a
      // "new" one has no date behind it and is merely waiting.
      if (p.status !== "new" && p.dueAt && Date.parse(p.dueAt) < startOfTodayMs) {
        overdueCards.add(p.cardId);
        overdueReps += 1;
      }
    } else if (p.dueAt) {
      const inDays = Math.ceil((Date.parse(p.dueAt) - todayEndMs) / DAY_MS);
      if (inDays >= 1 && inDays < FORECAST_DAYS) forecast[inDays].repetitions += 1;
    }
    const reviewedOn = dayKey(p.lastReviewedAt);
    if (reviewedOn) {
      reviewDays.add(reviewedOn);
      if (reviewedOn === todayKey) {
        reviewedToday += 1;
        forecast[0].reviewed += 1;
      }
    }
  }

  // Yesterday still counts as an unbroken streak until today is over.
  let streak = 0;
  const cursor = new Date(`${todayKey}T00:00:00.000Z`);
  if (!reviewDays.has(todayKey)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  while (reviewDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const totalDirections = cards.length * DIRECTIONS.length;
  return {
    today: todayKey,
    due_today: {
      cards: dueCards.size,
      repetitions: dueReps,
      by_direction: dueByDirection,
      // Part of today's queue that was scheduled for an earlier day. A session
      // left half-done reappears inside the next day's number, and without this
      // the spike has no explanation.
      overdue_repetitions: overdueReps,
      overdue_cards: overdueCards.size,
    },
    directions_started: started,
    directions_total: totalDirections,
    directions_percent: totalDirections > 0 ? Math.round((started / totalDirections) * 100) : 0,
    mature_cards: cards.filter((c) => (c.interval_days ?? 0) >= MATURE_INTERVAL_DAYS).length,
    struggling_cards: hardCards.size,
    reviewed_today: reviewedToday,
    streak_days: streak,
    forecast_next_days: forecast,
    note: `The same counts the app's own statistics panel shows: a prompt is due if it falls before the end of today, and every card is three prompts (${DIRECTIONS.join(", ")}). forecast_next_days[0] is today — its "reviewed" is what has already been done today and its "repetitions" is what is still waiting; later entries are what falls due on that date. Day boundaries are counted in UTC here, so a late-evening review may land on the learner's next day.`,
  };
}

/** Cards belonging to one dictionary batch, by id where possible. */
function cardsOfBatch(cards: CardRow[], batchId: string, batchTitle: string): CardRow[] {
  const byId = cards.filter((c) => c.source_book_id === batchId);
  if (byId.length > 0) return byId;
  // Batches created before cards carried the batch id are still recognisable
  // by the title stamped on their cards.
  return cards.filter((c) => !c.source_book_id && c.source_book_title === batchTitle);
}

/**
 * PostgREST filter strings are comma-separated; user text must not break out.
 *
 * The LIKE wildcards go too — `%` and `_` are syntax to the database and were
 * meant literally by whoever typed them — which is the same rule the app's own
 * catalogue search applies to what a reader types into the box.
 */
function sanitizeSearch(value: string): string {
  return value.replace(/[,()*%_"\\]/g, " ").trim().slice(0, 80);
}

// ─── Tool handlers ───────────────────────────────────────────────────────────

async function getOverview(ctx: Ctx): Promise<unknown> {
  const [langs, cards, variants, lessons, lessonCount, progress, batches, entryCount] = await Promise.all([
    getLanguages(ctx),
    getCards(ctx),
    getVariantProgress(ctx),
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
    readBatches(ctx.admin, ctx.userId, { limit: 5 }),
    ctx.admin
      .from("dictionary_entries")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ctx.userId),
  ]);

  const progressRows = progress.data ?? [];
  const deck = summarizeDeck(cards, variants);
  return {
    app: "aibook — language-learning app: reading texts, a personal dictionary in batches, and a spaced-repetition deck",
    target_language: langs.target,
    native_language: langs.native,
    flashcards: {
      total: cards.length,
      // The learner's own screen counts words due today and the prompts behind
      // them separately; quoting only one of the two misreports the workload.
      due_today: deck.due_today.cards,
      repetitions_due_today: deck.due_today.repetitions,
      learned: cards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS).length,
      struggling: deck.struggling_cards,
      streak_days: deck.streak_days,
      note: `learned = ${LEARNED_REPETITIONS}+ successful reviews in a row, in the recognition direction. Every card is trained in three directions, each on its own schedule — get_progress breaks it down.`,
    },
    dictionary: {
      words: entryCount.count ?? 0,
      batches: batches.batches.map((b) => ({
        id: b.id,
        title: b.title,
        topic: b.topic,
        words: b.word_count,
        cards: cardsOfBatch(cards, b.id, b.title).length,
        training_summary: describePackTraining(normalizePackTraining(b.training)) || null,
      })),
      note: "A pack («пачка») is one unit of study — a photographed coursebook page, or a themed set of words, phrases or sentences. list_word_batches shows them all with progress and with the training setup each one carries.",
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

/**
 * What this connection has changed, most recent first.
 *
 * Every non-read tool call is logged centrally in callMcpTool, whether it
 * succeeded or not — this just reads that trail back. It answers "what did
 * you already do?" inside one long conversation, and gives the learner
 * something to audit besides trusting an agent's own account of itself.
 */
async function getActionHistory(ctx: Ctx, args: Args): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 200);
  const toolName = typeof args.tool_name === "string" ? args.tool_name.trim() : "";
  const onlyFailed = args.only_failed === true;

  let request = ctx.admin
    .from("mcp_action_log")
    .select("tool_name, args, result_summary, ok, error, created_at")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (toolName) request = request.eq("tool_name", toolName);
  if (onlyFailed) request = request.eq("ok", false);

  const { data, error } = await request;
  if (error) {
    const missing = error.message.includes("mcp_action_log") || error.code === "PGRST205";
    throw new Error(
      missing
        ? "This aibook deployment has not run the action-history migration yet."
        : `action history read failed: ${error.message}`,
    );
  }

  return {
    returned: (data ?? []).length,
    actions: (data ?? []).map((row) => ({
      tool: row.tool_name,
      at: row.created_at,
      ok: row.ok,
      args: row.args,
      result: row.result_summary,
      error: row.error,
    })),
    note: "Only tools that change data (add_/create_/update_/delete_) are logged; reads never are. This is a plain record of MCP calls, separate from anything the app itself logs.",
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

/** A card is struggling when any one of its three directions is. */
function isStruggling(card: CardRow, byCard: Map<string, DirectionProgress[]>): boolean {
  return (byCard.get(card.id) ?? []).some(isStrugglingProgress);
}

function groupByCard(progress: DirectionProgress[]): Map<string, DirectionProgress[]> {
  const byCard = new Map<string, DirectionProgress[]>();
  for (const p of progress) {
    const list = byCard.get(p.cardId) ?? [];
    list.push(p);
    byCard.set(p.cardId, list);
  }
  return byCard;
}

async function listFlashcards(ctx: Ctx, args: Args): Promise<unknown> {
  const filter: CardFilter = CARD_FILTERS.includes(args.filter as CardFilter)
    ? (args.filter as CardFilter)
    : "all";
  const limit = Math.min(Math.max(Number(args.limit) || 100, 1), 500);
  const search = typeof args.search === "string" ? normalizeCardText(args.search) : "";
  const batchId = typeof args.batch_id === "string" ? args.batch_id.trim() : "";
  const type = typeof args.type === "string" ? args.type.trim() : "";

  const [allCards, variants] = await Promise.all([getCards(ctx), getVariantProgress(ctx)]);
  let cards = allCards;
  const todayEndMs = endOfTodayMs(new Date());
  const byCard = groupByCard(directionProgress(cards, variants));
  const dueDirections = (card: CardRow): Direction[] =>
    (byCard.get(card.id) ?? []).filter((p) => isDueToday(p, todayEndMs)).map((p) => p.direction);

  // "Due" means what the app's «К повторению» list means: any direction of the
  // card is waiting, not only the one whose schedule sits on the card row.
  if (filter === "due") cards = cards.filter((c) => dueDirections(c).length > 0);
  if (filter === "learned") cards = cards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS);
  if (filter === "new") cards = cards.filter((c) => (c.repetitions ?? 0) === 0);
  if (filter === "struggling") cards = cards.filter((c) => isStruggling(c, byCard));
  if (batchId) cards = cards.filter((c) => c.source_book_id === batchId);
  if (CARD_TYPES.includes(type as typeof CARD_TYPES[number])) {
    cards = cards.filter((c) => (c.selection_type ?? "word") === type);
  }
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
      // Which of the three trainings this card is waiting for today.
      due_directions: dueDirections(c),
      source: c.source_book_title,
      batch_id: c.source_book_id,
    })),
    note: "'repetitions', 'lapses' and 'next_review_at' describe the recognition direction, the one stored on the card itself. 'due_directions' covers all three.",
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

/**
 * Remove a whole pack — the entries that make it up, and the row itself.
 *
 * The flashcards it produced are deliberately left alone, for the same reason
 * DELETE /api/dictionary?batchId= leaves them alone: review history is not
 * something a cleanup should destroy. What is left of the pack afterwards is
 * a group of cards sharing a source name, exactly like a pack that was never
 * given a row — list_word_batches shows it under card_groups_without_a_pack,
 * and delete_flashcards is the tool for taking the cards too, once asked.
 */
async function deletePack(ctx: Ctx, args: Args): Promise<unknown> {
  const batchId = String(args.batch_id ?? "").trim();
  if (!batchId) throw new Error("Pass 'batch_id' from list_word_batches.");

  const { data: pack, error: readError } = await ctx.admin
    .from("dictionary_batches")
    .select("id, title")
    .eq("id", batchId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (readError) throw new Error(`pack read failed: ${readError.message}`);
  if (!pack) throw new Error("No such pack in this learner's dictionary — check list_word_batches.");

  const { error: entriesError } = await ctx.admin
    .from("dictionary_entries")
    .delete()
    .eq("batch_id", batchId)
    .eq("user_id", ctx.userId);
  if (entriesError) throw new Error(`dictionary entries delete failed: ${entriesError.message}`);

  const { error: batchError } = await ctx.admin
    .from("dictionary_batches")
    .delete()
    .eq("id", batchId)
    .eq("user_id", ctx.userId);
  if (batchError) throw new Error(`pack delete failed: ${batchError.message}`);

  const { count } = await ctx.admin
    .from("flashcards")
    .select("id", { count: "exact", head: true })
    .eq("user_id", ctx.userId)
    .eq("source_book_id", batchId);
  const cardsLeft = count ?? 0;

  return {
    deleted_pack: pack.title,
    cards_left_behind: cardsLeft,
    note: cardsLeft > 0
      ? "The pack row is gone, but its flashcards are still in the deck — deleting a pack must not throw away review history. They now show as a card group sharing this source name; call list_flashcards with this same batch_id, then delete_flashcards if the learner wants the cards gone too."
      : "The pack and its dictionary entries are gone. No flashcards were left behind.",
  };
}

async function addFlashcards(ctx: Ctx, args: Args): Promise<unknown> {
  const rawCards = Array.isArray(args.cards) ? args.cards.slice(0, 100) : [];
  const namedSource = typeof args.source === "string" && args.source.trim()
    ? args.source.trim().slice(0, 120)
    : "";
  // A named source is a pack by every measure the learner can see: the app
  // groups cards by source name and shows the group with a title, a progress
  // bar and a «тренировать» button. What it could not show was a delete or a
  // setup, because there was no row behind it — so an agent that filled in
  // 'source' instead of 'batch_title' left the learner with a pack they could
  // not act on. The grouping does not change here; it just gets its row.
  const batchTitle = String(args.batch_title ?? "").trim().slice(0, 200) || namedSource;
  const batchIdArg = String(args.batch_id ?? "").trim();
  const source = batchTitle || namedSource || "Из чата с ИИ";

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

  // A themed set becomes a pack: one row in the learner's Словарь with its own
  // progress bar, its own «тренировать» button and, if you set one, its own
  // training setup. Without a pack the cards are only a source name buried in a
  // filter list, which is where sets built over MCP used to disappear.
  let packId: string | null = null;
  let packTitle = "";
  if (batchIdArg) {
    const { batches } = await readBatches(ctx.admin, ctx.userId, { limit: 200 });
    const found = batches.find((b) => b.id === batchIdArg);
    if (!found) throw new Error("No such pack in this learner's dictionary — check list_word_batches.");
    packId = found.id;
    packTitle = found.title;
  } else if (batchTitle) {
    const langs = await getLanguages(ctx);
    const pack = await findOrCreatePack(ctx.admin, ctx.userId, {
      title: batchTitle,
      kind: namedSource && namedSource !== batchTitle ? namedSource : "от ИИ-ассистента",
      topic: String(args.topic ?? "").trim().slice(0, 80),
      language: langs.target,
      training: normalizePackTraining(args.training),
      ...packDetails(args),
    });
    if (!pack.ok) throw new Error(pack.error);
    packId = pack.id;
    packTitle = batchTitle;
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
    const srs = createDefaultSrsFields(packId, packTitle || source);
    rows.push({
      user_id: ctx.userId,
      vocabulary_item_id: null,
      front: card.front,
      back: card.back,
      source_book_title: packTitle || source,
      selection_type: card.type,
      repetitions: srs.repetitions,
      lapses: srs.lapses,
      easiness_factor: srs.easeFactor,
      interval_days: srs.intervalDays,
      next_review_at: srs.dueAt,
      last_reviewed_at: srs.lastReviewedAt,
      source_book_id: packId,
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
    batch_id: packId,
    batch_title: packTitle || null,
    note: packId
      ? "The pack is on the learner's Словарь screen with its own progress and «тренировать» button. Cards appear after they reopen or refresh the app. Give it a description with update_pack_details."
      : "Loose cards, filed under «Из чата с ИИ». For a themed set pass 'batch_title' so it becomes a pack the learner can see, train and manage on its own. Cards appear after they reopen or refresh the app.",
  };
}

/**
 * How one pack asks to be trained.
 *
 * The learner's own trainer filters are the default for everything; this is the
 * exception a particular pack carries — «эти фразы я хочу переводить с русского
 * и на слух». Passing a title that is only a group of cards sharing a source
 * turns that group into a real pack first, without touching a single schedule.
 */
async function updateBatchTraining(ctx: Ctx, args: Args): Promise<unknown> {
  const batchId = String(args.batch_id ?? "").trim();
  const title = String(args.title ?? "").trim().slice(0, 200);
  if (!batchId && !title) {
    throw new Error("Pass 'batch_id' from list_word_batches, or 'title' of the pack.");
  }

  const reset = args.reset === true;
  const training = reset ? null : normalizePackTraining(args);
  if (!reset && !training) {
    throw new Error(
      "Nothing to set. Pass 'variants' (forward / reverse / audio), and/or 'type', 'status', 'mode', 'note' — or 'reset': true to go back to the learner's own filters.",
    );
  }

  const { batches, error } = await readBatches(ctx.admin, ctx.userId, { limit: 200 });
  if (error) throw new Error(`batches read failed: ${error}`);

  let pack = batchId
    ? batches.find((b) => b.id === batchId)
    : batches.find((b) => b.title === title);
  let adopted = 0;

  if (!pack) {
    if (batchId) throw new Error("No such pack in this learner's dictionary — check list_word_batches.");
    // A group of cards under one source name: make it the pack it already is.
    const cards = await getCards(ctx);
    const matching = cards.filter((c) => !c.source_book_id && (c.source_book_title ?? "") === title);
    if (matching.length === 0) {
      throw new Error(`Nothing called «${title}» — call list_word_batches to see the packs and the card groups.`);
    }
    const langs = await getLanguages(ctx);
    const created = await findOrCreatePack(ctx.admin, ctx.userId, {
      title,
      kind: "от ИИ-ассистента",
      language: langs.target,
      training,
    });
    if (!created.ok) throw new Error(created.error);
    const adoption = await adoptCardsIntoPack(ctx.admin, ctx.userId, title, created.id);
    if (adoption.error) throw new Error(`Не удалось привязать карточки к пачке: ${adoption.error}`);
    adopted = adoption.adopted;
    pack = { id: created.id, title, kind: "", topic: "", language: langs.target, word_count: 0, created_at: "" };
  }

  const { error: writeError } = await ctx.admin
    .from("dictionary_batches")
    .update({ training: training ?? {} })
    .eq("id", pack.id)
    .eq("user_id", ctx.userId);
  if (writeError) {
    const missing = /training/.test(writeError.message);
    throw new Error(
      missing
        ? "This aibook deployment has not run the pack-training migration yet, so preferences cannot be stored."
        : `training update failed: ${writeError.message}`,
    );
  }

  return {
    batch_id: pack.id,
    title: pack.title,
    training: training ?? {},
    summary: describePackTraining(training) || "the learner's own trainer filters",
    cards_adopted: adopted,
    note: training
      ? "«Тренировать» on this pack now opens the trainer set up this way. The learner's own filters are untouched and still apply to every other pack."
      : "Preferences cleared — this pack trains with the learner's own filters again.",
  };
}

/**
 * What a pack is, and what it was built to.
 *
 * Separate from the training setup on purpose: one says how the pack is
 * drilled, this says what is in it and why. It is written at creation time by
 * whoever builds the pack, and this is how it gets fixed or filled in later.
 */
async function describePack(ctx: Ctx, args: Args): Promise<unknown> {
  const batchId = String(args.batch_id ?? "").trim();
  const title = String(args.title ?? "").trim().slice(0, 200);
  if (!batchId && !title) {
    throw new Error("Pass 'batch_id' from list_word_batches, or 'title' of the pack.");
  }

  const details = packDetails(args);
  if (!details.description && !details.instruction) {
    throw new Error("Nothing to set. Pass 'description' (what this pack is, in the learner's language) and/or 'instruction' (the brief it was built to).");
  }

  const { batches, error } = await readBatches(ctx.admin, ctx.userId, { limit: 200 });
  if (error) throw new Error(`batches read failed: ${error}`);

  let pack = batchId
    ? batches.find((b) => b.id === batchId)
    : batches.find((b) => b.title === title);
  let adopted = 0;

  if (!pack) {
    if (batchId) throw new Error("No such pack in this learner's dictionary — check list_word_batches.");
    // A group of cards under one source name: make it the pack it already is,
    // the same way update_batch_training does.
    const cards = await getCards(ctx);
    const matching = cards.filter((c) => !c.source_book_id && (c.source_book_title ?? "") === title);
    if (matching.length === 0) {
      throw new Error(`Nothing called «${title}» — call list_word_batches to see the packs and the card groups.`);
    }
    const langs = await getLanguages(ctx);
    const created = await findOrCreatePack(ctx.admin, ctx.userId, {
      title,
      kind: "от ИИ-ассистента",
      language: langs.target,
      ...details,
    });
    if (!created.ok) throw new Error(created.error);
    const adoption = await adoptCardsIntoPack(ctx.admin, ctx.userId, title, created.id);
    if (adoption.error) throw new Error(`Не удалось привязать карточки к пачке: ${adoption.error}`);
    adopted = adoption.adopted;
    pack = { id: created.id, title, kind: "", topic: "", language: langs.target, word_count: 0, created_at: "" };
  }

  // Only what was passed is written: filling in the brief must not blank the
  // description someone wrote a month ago.
  const patch: Record<string, unknown> = {};
  if (details.description) patch.description = details.description;
  if (details.instruction) patch.instruction = details.instruction;

  const { error: writeError } = await ctx.admin
    .from("dictionary_batches")
    .update(patch)
    .eq("id", pack.id)
    .eq("user_id", ctx.userId);
  if (writeError) {
    throw new Error(
      /description|instruction/.test(writeError.message)
        ? "This aibook deployment has not run the pack-description migration yet, so a pack cannot carry one."
        : `pack description update failed: ${writeError.message}`,
    );
  }

  return {
    batch_id: pack.id,
    title: pack.title,
    description: details.description || null,
    instruction: details.instruction || null,
    cards_adopted: adopted,
    note: "The description is shown under the pack title in the learner's Словарь; the brief is one tap away from it. Read the brief back before adding anything to this pack.",
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
  const [{ batches, error }, cards, variants] = await Promise.all([
    readBatches(ctx.admin, ctx.userId, { limit: 100 }),
    getCards(ctx),
    getVariantProgress(ctx),
  ]);
  if (error) throw new Error(`batches read failed: ${error}`);
  const byCard = groupByCard(directionProgress(cards, variants));

  const progressOf = (batchCards: CardRow[]) =>
    batchCards.length > 0
      ? {
          cards: batchCards.length,
          started: batchCards.filter((c) => (c.repetitions ?? 0) > 0).length,
          learned: batchCards.filter((c) => (c.repetitions ?? 0) >= LEARNED_REPETITIONS).length,
          struggling: batchCards.filter((c) => isStruggling(c, byCard)).length,
          percent: Math.round(
            (batchCards.filter((c) => (c.repetitions ?? 0) > 0).length / batchCards.length) * 100,
          ),
        }
      : null;

  const listed = batches.map((b) => {
    const batchCards = cardsOfBatch(cards, b.id, b.title);
    const training = normalizePackTraining(b.training);
    return {
      id: b.id,
      title: b.title,
      topic: b.topic,
      page: b.kind,
      language: b.language,
      words: b.word_count,
      cards: batchCards.length,
      created_at: b.created_at,
      training,
      training_summary: describePackTraining(training) || "the learner's own trainer filters",
      // What the pack is, and the brief it was built to. This is how a pack is
      // recognised months later, and how you extend one without being told its
      // rules again.
      description: b.description || null,
      instruction: b.instruction || null,
      progress: progressOf(batchCards),
    };
  });

  // Cards an assistant added with a source name of their own, before packs
  // could hold anything but dictionary words. They are a pack in everything but
  // the row, and the learner sees them as one — so they are listed here too,
  // and update_batch_training turns one into a real pack when asked.
  const claimed = new Set(batches.map((b) => b.title));
  const looseByTitle = new Map<string, CardRow[]>();
  for (const card of cards) {
    const title = card.source_book_title ?? "";
    if (card.source_book_id || !title || claimed.has(title)) continue;
    looseByTitle.set(title, [...(looseByTitle.get(title) ?? []), card]);
  }

  const unregistered = [...looseByTitle.entries()].map(([title, batchCards]) => ({
    id: null,
    title,
    cards: batchCards.length,
    progress: progressOf(batchCards),
    note: "Not a pack row yet — a group of cards sharing this source. Pass this title to update_batch_training to make it a real pack with its own training setup.",
  }));

  return {
    explanation:
      "A pack («пачка») is one set of material the learner studies as a unit — a photographed coursebook page, or a themed set of words, phrases or sentences you built with them. In the app it has its own progress bar and its own «тренировать» button. Progress is measured from the flashcards in it.",
    training_note:
      "Each pack may carry its own training setup (direction, card type, status, trainer mode). Where it says nothing, the learner's own trainer filters apply. Set it with update_batch_training.",
    description_note:
      "'description' says what a pack is; 'instruction' is the brief it was built to — the criteria its material had to meet («винительный падеж, только мужской род, одно прилагательное или без него, единственное число»). Read 'instruction' before adding anything to an existing pack: material that breaks the brief is what makes a pack stop being usable. Set both with update_pack_details.",
    batches: listed,
    card_groups_without_a_pack: unregistered,
    next: "list_batch_words shows one pack's dictionary words; add_words_to_batch adds to it; add_word_batch starts a new one; add_flashcards with 'batch_title' builds a pack of phrases or sentences.",
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

  const training = normalizePackTraining(args.training);
  const details = packDetails(args);
  const batchRow: Record<string, unknown> = {
    user_id: ctx.userId,
    title,
    kind: String(args.source ?? "от ИИ-ассистента").slice(0, 120),
    topic: String(args.topic ?? "").trim().slice(0, 80),
    language,
    word_count: drafts.length,
  };
  if (training) batchRow.training = training;
  if (details.description) batchRow.description = details.description;
  if (details.instruction) batchRow.instruction = details.instruction;

  let { data: batch, error } = await ctx.admin
    .from("dictionary_batches")
    .insert(batchRow)
    .select("id")
    .single();
  // A deployment that has not run the description migration yet must still be
  // able to take the words; it just cannot keep the brief with them.
  if (error && /description|instruction/.test(error.message)) {
    delete batchRow.description;
    delete batchRow.instruction;
    ({ data: batch, error } = await ctx.admin
      .from("dictionary_batches")
      .insert(batchRow)
      .select("id")
      .single());
  }
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
    training: training ?? {},
    training_summary: describePackTraining(training) || "the learner's own trainer filters",
    description: details.description || null,
    instruction: details.instruction || null,
    note: "The batch appears in the learner's Словарь as its own page, with its own progress and a «тренировать» button; every new word is already a flashcard. Words that were already cards kept the review history they had.",
  };
}

// ─── How the learning is actually going ─────────────────────────────────────

async function getProgress(ctx: Ctx, args: Args): Promise<unknown> {
  const limit = Math.min(Math.max(Number(args.limit) || 40, 1), 200);
  const [cards, variants] = await Promise.all([getCards(ctx), getVariantProgress(ctx)]);
  const now = Date.now();
  const todayEndMs = endOfTodayMs(new Date(now));
  const deck = summarizeDeck(cards, variants, new Date(now));
  const byCard = groupByCard(directionProgress(cards, variants));

  // A word is struggling when any of its three directions is — the same rule
  // the app's «Сложные» filter uses, so this list matches what the learner sees.
  const isHard = (cardId: string) => (byCard.get(cardId) ?? []).some(isStrugglingProgress);

  const withStats = cards.map((c) => {
    const reps = c.repetitions ?? 0;
    const lapses = c.lapses ?? 0;
    return {
      // Carried so an agent can fix or drop a word straight from this list.
      id: c.id,
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
      // Which trainings this word is waiting for today, so an agent drilling
      // the struggling list knows whether to ask for reading or for producing.
      due_directions: (byCard.get(c.id) ?? [])
        .filter((p) => isDueToday(p, todayEndMs))
        .map((p) => p.direction),
      struggling: isHard(c.id),
      source: c.source_book_title ?? "",
    };
  });

  const struggling = withStats
    .filter((w) => w.struggling)
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

  const allDirections = directionProgress(cards, variants);

  return {
    totals: {
      cards: cards.length,
      never_studied: untouched.length,
      in_progress: withStats.filter((w) => w.reps > 0 && w.reps < LEARNED_REPETITIONS).length,
      confident: withStats.filter((w) => w.reps >= LEARNED_REPETITIONS && w.lapses === 0).length,
      struggling: deck.struggling_cards,
      due_today: deck.due_today.cards,
    },
    // What the learner's own statistics panel says: today's workload, the
    // streak they are protecting, and what the next week looks like.
    deck,
    by_level: ["A1", "A2", "B1", "B2", "C1", "C2"].map((level) => ({
      level,
      total: withStats.filter((w) => w.level === level).length,
      confident: withStats.filter((w) => w.level === level && w.reps >= LEARNED_REPETITIONS && w.lapses === 0).length,
    })).filter((row) => row.total > 0),
    // The same word is scheduled separately in each direction, so "knowing" it
    // is not one number: a learner who reads a word fluently may still be
    // unable to produce it from the Russian.
    by_direction: DIRECTIONS.map((direction) => {
      const rows = allDirections.filter((p) => p.direction === direction);
      const started = rows.filter((r) => r.repetitions > 0).length;
      return {
        direction,
        means: SKILL_NAMES[direction],
        started,
        confident: rows.filter((r) => r.repetitions >= LEARNED_REPETITIONS && r.lapses === 0).length,
        due_today: rows.filter((r) => isDueToday(r, todayEndMs)).length,
        not_started: cards.length - started,
      };
    }),
    struggling,
    confident,
    learning,
    how_to_use:
      "Practise new grammar with the 'confident' words so the sentence is about the construction, not the vocabulary. Weave 'struggling' words into examples and stories as often as you can — those are the ones being forgotten. Leave 'never studied' words alone unless the learner asks. If 'reverse' is far behind 'forward', the learner recognises words they cannot yet produce — ask them to say things, not just read them.",
    not_included:
      "The app's second trainer («Активно» — a written test over three tracks: вспоминаю / слушаю / говорю) keeps its record on the learner's own device, so none of it reaches this connection. What you see here is the «Повторение» deck.",
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

  const query = sanitizeSearch(String(args.query ?? ""));
  const asked = String(args.shelf ?? "").trim();
  const shelf = (CATALOGUE_SHELVES as readonly string[]).includes(asked) ? (asked as CatalogueShelf) : "";

  let request = ctx.admin
    .from("shared_books")
    .select("id, title, author, cefr_level, language, source_type, course_title, total_chars, metadata")
    .is("owner_user_id", null)
    .eq("language", language)
    // The catalogue outgrew the point where an unordered slice was a fair
    // sample of it — the app pages through it now. Ordering by level, then by
    // title, means the candidates below are a stretch of one level rather than
    // whatever the database happened to return first.
    .order("cefr_level", { ascending: true, nullsFirst: false })
    .order("title", { ascending: true })
    .limit(CATALOGUE_CANDIDATES);
  if (LEVELS.includes(level as CefrLevel)) request = request.eq("cefr_level", level);
  if (shelf) request = request.eq("source_type", shelf);
  if (query) request = request.ilike("title", `%${query}%`);

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
      shelf: b.source_type,
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
    note: "Public texts in the app's catalogue («Обзор»), on the shelves the app shows: 'klexikon' (short encyclopedia articles in simple German), 'universal_cefr' (graded texts by level), and the rest. 'comfortable' means the learner already knows 90–98% of the words — the band where reading teaches most. Open one with get_text.",
    ...(books && books.length >= CATALOGUE_CANDIDATES
      ? {
          more: `The catalogue is larger than one look at it: these are the first ${CATALOGUE_CANDIDATES} matches, ordered by level. Narrow with 'level', 'shelf' or 'query' if nothing here fits.`,
        }
      : {}),
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
      "What is in the learner's aibook right now: target/native language, flashcard counts (total, due today, learned, struggling, review streak), dictionary size and recent word batches, recent lessons, reading progress. Call this first — it also lists what else you can do here.",
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
    name: "get_action_history",
    title: "История действий",
    description:
      "What this connection has changed in the learner's aibook, most recent first — every add/create/update/delete call, whether it succeeded, and what it did. Use it to check what you already did earlier in this conversation before doing it again, or to show the learner an audit trail of what an agent changed on their behalf.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 30, max 200" },
        tool_name: { type: "string", description: "Only actions from this tool, e.g. 'delete_flashcards'" },
        only_failed: { type: "boolean", description: "Only calls that errored" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "История действий" },
  },
  {
    name: "get_progress",
    title: "Как идёт учёба",
    description:
      "How the learning is actually going, from the spaced-repetition record: which words the learner knows confidently, which are in progress, and which they keep forgetting (repeated lapses or an ease factor the algorithm has pushed down), with totals by CEFR level and by training direction (recognition / recall / listening — each word is scheduled separately in each). It also returns the deck numbers the app's own statistics panel shows: today's date and workload in words and in repetitions (including how much of it is carried over from earlier days), what has already been reviewed today, the review streak, and a seven-day forecast that starts with today and dates every entry. Use the confident words when practising a new construction — the sentence should test the grammar, not the vocabulary — and work the struggling ones into examples and stories.",
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
      "List the learner's flashcards with their scheduling state and ids. Filter by 'due', 'learned', 'new' or 'struggling', narrow to one dictionary batch or one card 'type', or search the text of the cards. Each card says which of its three trainings are waiting today ('due_directions'). The ids are what update_flashcard and delete_flashcards take. Use 'type': 'sentence' to find full-sentence cards mixed into what should be a pack of words or set phrases.",
    inputSchema: {
      type: "object",
      properties: {
        filter: {
          type: "string",
          enum: ["all", "due", "learned", "new", "struggling"],
          description: "Default 'all'. 'due' = any direction waiting today, the same list the app shows. 'struggling' = repeatedly forgotten.",
        },
        type: {
          type: "string",
          enum: ["word", "phrase", "sentence"],
          description: "Only cards of this kind — 'word' a single word, 'phrase' a short fixed expression (e.g. Sicher ist sicher), 'sentence' a full clause. Set when the card was added; older cards default to 'word'.",
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
      "The ready-made public texts in the app's catalogue, with the share of words the learner already knows in each and whether it sits in the comfortable 90–98% band. Search it by title, or narrow it to one shelf or one CEFR level — the catalogue is far larger than one page of results. Use it to answer «что мне почитать?» with something from the app instead of writing a new text.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search the titles, e.g. «Fahrrad»" },
        shelf: {
          type: "string",
          enum: ["klexikon", "universal_cefr", "oersi", "dw", "generated"],
          description: "One shelf of the catalogue: 'klexikon' = short encyclopedia articles in simple German, 'universal_cefr' = texts graded by level",
        },
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
      "Add flashcards to the learner's spaced-repetition deck. 'front' is the word/phrase/sentence in the language being learned, 'back' is the translation into the learner's native language. Duplicates (same front) are skipped automatically. Pass 'batch_title' whenever these cards belong together — a set of phrases for one grammar topic, sentences from one lesson: that makes them a pack («пачка») on the learner's Словарь screen, with its own progress bar and its own «тренировать» button, and lets you give it a training setup. Without it the cards are loose and reachable only through a filter. Use add_word_batch instead when the material is dictionary words (article, plural, verb forms) rather than phrases or sentences.",
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
        batch_title: {
          type: "string",
          description: "Makes these cards a pack under this name, in the learner's native language — «Akkusativ: мужской род · фразы». An existing pack with the same title is reused.",
        },
        batch_id: { type: "string", description: "Add to an existing pack by id (from list_word_batches) instead of by title" },
        topic: { type: "string", description: "Two or three words naming the theme of the pack" },
        description: {
          type: "string",
          description: "What this pack is, in the learner's native language — one or two sentences. Shown under the pack title, and the only thing that tells one pack of nouns from the next months later. Always write it.",
        },
        instruction: {
          type: "string",
          description: "The brief this pack was built to — the exact criteria its material had to meet («винительный падеж, только мужской род, одно прилагательное или без него, единственное число»). Write down what you were asked for, so the pack can be extended later without being explained again.",
        },

        training: {
          type: "object",
          description: "How this pack should be trained, when it is created. Same fields as update_batch_training.",
          properties: {
            variants: { type: "array", items: { type: "string", enum: ["forward", "reverse", "audio"] } },
            type: { type: "string", enum: ["all", "word", "phrase", "sentence"] },
            status: { type: "string", enum: ["all", "new", "learning", "review", "relearning", "hard"] },
            mode: { type: "string", enum: ["recognize", "active"] },
            note: { type: "string" },
          },
        },
        source: { type: "string", description: "Where these came from, shown under the pack title (default 'Из чата с ИИ')" },
      },
      required: ["cards"],
      additionalProperties: false,
    },
    annotations: { ...WRITES, title: "Добавить карточки" },
  },
  {
    name: "update_batch_training",
    title: "Настроить тренировку пачки",
    description:
      "Set how one pack is trained, so «тренировать» on it opens the trainer already configured that way — «эти фразы я хочу переводить с русского и слушать». 'variants' is the prompt direction: 'forward' shows the target language and asks for the meaning, 'reverse' shows the learner's own language and asks them to produce the target one, 'audio' plays it and asks for both; pass several to mix them. 'type' and 'status' narrow which cards of the pack take part, 'mode' picks the trainer ('recognize' is the flashcard trainer, 'active' the written one). Whatever you leave out falls back to the learner's own filters, and 'reset': true clears the pack's setup entirely. Identify the pack by 'batch_id', or by 'title' — a title that is still only a group of cards sharing a source becomes a real pack.",
    inputSchema: {
      type: "object",
      properties: {
        batch_id: { type: "string", description: "Pack id from list_word_batches" },
        title: { type: "string", description: "Pack title, if you do not have the id" },
        variants: {
          type: "array",
          items: { type: "string", enum: ["forward", "reverse", "audio"] },
          description: "Prompt directions this pack is drilled in; omit for every direction",
        },
        type: { type: "string", enum: ["all", "word", "phrase", "sentence"], description: "Only cards of this type" },
        status: {
          type: "string",
          enum: ["all", "new", "learning", "review", "relearning", "hard"],
          description: "Only cards at this stage ('hard' = the ones being forgotten)",
        },
        mode: { type: "string", enum: ["recognize", "active"], description: "Which trainer opens; default 'recognize'" },
        note: { type: "string", description: "One line for the learner, in their language, on why it is set up this way" },
        reset: { type: "boolean", description: "Clear the pack's setup and go back to the learner's own filters" },
      },
      additionalProperties: false,
    },
    annotations: { ...WRITES, idempotentHint: true, title: "Настроить тренировку пачки" },
  },
  {
    name: "update_pack_details",
    title: "Описание пачки",
    description:
      "Say what a pack is and what it was built to. 'description' is one or two sentences in the learner's own language, shown under the pack title on their Словарь screen — it is what lets them tell one shelf of noun packs from another months later. 'instruction' is the brief: the exact criteria the material had to meet, in the words it was asked for («винительный падеж, только мужской род, одно прилагательное или без него, единственное число»). Write both whenever you build a pack, and read the brief back with list_word_batches before adding anything to an existing one — material that breaks the brief is what makes a pack stop being usable. Identify the pack by 'batch_id', or by 'title'; a title that is still only a group of cards sharing a source becomes a real pack.",
    inputSchema: {
      type: "object",
      properties: {
        batch_id: { type: "string", description: "Pack id from list_word_batches" },
        title: { type: "string", description: "Pack title, if you do not have the id" },
        description: {
          type: "string",
          description: "What this pack is, in the learner's native language — one or two sentences. Shown under the pack title, and the only thing that tells one pack of nouns from the next months later. Always write it.",
        },
        instruction: {
          type: "string",
          description: "The brief this pack was built to — the exact criteria its material had to meet («винительный падеж, только мужской род, одно прилагательное или без него, единственное число»). Write down what you were asked for, so the pack can be extended later without being explained again.",
        },
      },
      additionalProperties: false,
    },
    annotations: { ...WRITES, idempotentHint: true, title: "Описание пачки" },
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
        description: {
          type: "string",
          description: "What this pack is, in the learner's native language — one or two sentences. Shown under the pack title, and the only thing that tells one pack of nouns from the next months later. Always write it.",
        },
        instruction: {
          type: "string",
          description: "The brief this pack was built to — the exact criteria its material had to meet («винительный падеж, только мужской род, одно прилагательное или без него, единственное число»). Write down what you were asked for, so the pack can be extended later without being explained again.",
        },
        language: { type: "string", description: "ISO code; defaults to the learner's target language" },
        source: { type: "string", description: "Where the words came from; shown under the title" },
        training: {
          type: "object",
          description: "How this pack should be trained. Same fields as update_batch_training; omit to leave the learner's own filters in charge.",
          properties: {
            variants: { type: "array", items: { type: "string", enum: ["forward", "reverse", "audio"] } },
            type: { type: "string", enum: ["all", "word", "phrase", "sentence"] },
            status: { type: "string", enum: ["all", "new", "learning", "review", "relearning", "hard"] },
            mode: { type: "string", enum: ["recognize", "active"] },
            note: { type: "string" },
          },
        },
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
  {
    name: "delete_pack",
    title: "Удалить пачку",
    description:
      "Delete a whole pack («пачка») and its dictionary entries — for a pack that turned out empty, wrong, or that the learner asked you to remove. The flashcards it produced are left in the deck untouched: deleting a pack must not throw away review history. If cards remain, they show as a plain group by source name (list_word_batches, card_groups_without_a_pack) — delete_flashcards is the tool for removing those too, once asked. Ask the learner first unless they named this pack themselves or you are cleaning up a mistake you just made.",
    inputSchema: {
      type: "object",
      properties: {
        batch_id: { type: "string", description: "Pack id from list_word_batches" },
      },
      required: ["batch_id"],
      additionalProperties: false,
    },
    annotations: { ...DESTRUCTIVE, title: "Удалить пачку" },
  },
];

const HANDLERS: Record<string, (ctx: Ctx, args: Args) => Promise<unknown>> = {
  get_overview: (ctx) => getOverview(ctx),
  get_capabilities: async () => getCapabilities(),
  get_action_history: getActionHistory,
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
  update_pack_details: describePack,
  add_word_batch: addWordBatch,
  add_words_to_batch: addWordsToBatch,
  update_batch_training: updateBatchTraining,
  create_lesson: createLesson,
  update_flashcard: updateFlashcard,
  delete_flashcards: deleteFlashcards,
  delete_pack: deletePack,
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

// How much of an argument or a result the log keeps. Generous enough to read
// back what actually happened (a batch of card fronts, a pack id) without
// letting one call — a lesson's full paragraphs, say — blow up a row.
const LOG_VALUE_LIMIT = 4000;

function truncateForLog(value: unknown): unknown {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "null";
  } catch {
    return null;
  }
  if (json.length <= LOG_VALUE_LIMIT) return value;
  return { truncated: true, preview: json.slice(0, LOG_VALUE_LIMIT) };
}

/**
 * One row per non-read tool call, success or failure — the record that
 * get_action_history reads back. Logging is best-effort: a deployment
 * without the migration, or any failure to write the row, must never turn
 * an action that actually happened into an error the caller sees.
 */
async function logAction(
  admin: SupabaseClient,
  userId: string,
  name: string,
  args: Args,
  result: unknown,
  ok: boolean,
  errorMessage: string | null,
): Promise<void> {
  try {
    await admin.from("mcp_action_log").insert({
      user_id: userId,
      tool_name: name,
      args: truncateForLog(args),
      result_summary: ok ? truncateForLog(result) : null,
      ok,
      error: errorMessage,
    });
  } catch {
    // Logging must not be able to break the action it is describing.
  }
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

  const readOnly = MCP_TOOLS.find((t) => t.name === name)?.annotations?.readOnlyHint === true;
  if (readOnly) return handler({ admin, userId }, args);

  try {
    const result = await handler({ admin, userId }, args);
    await logAction(admin, userId, name, args, result, true, null);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logAction(admin, userId, name, args, null, false, message);
    throw err;
  }
}
