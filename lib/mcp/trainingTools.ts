// MCP tools for the history of trainer answers: what was actually answered,
// when, and how — articles, verb forms, conjugations, translations — as
// opposed to get_progress, which reads the SM-2 schedule of the deck.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CHECKS, OUTCOMES, TRAINERS } from "@/lib/training/events";
import { trainingHistory, trainingSummary } from "@/lib/training/store";
import type { McpToolDef } from "@/lib/mcp/tools";

type Ctx = { admin: SupabaseClient; userId: string };
type Args = Record<string, unknown>;

const READ_ONLY = { readOnlyHint: true, openWorldHint: false };

const PERIOD = {
  period: { type: "string", enum: ["today", "yesterday", "last_7_days", "last_30_days", "all"], description: "Named period in the learner's own time zone (default: today for the summary, last_7_days for history)" },
  from: { type: "string", description: "YYYY-MM-DD, the learner's local date; overrides period" },
  to: { type: "string", description: "YYYY-MM-DD, inclusive" },
  time_zone: { type: "string", description: "IANA zone; defaults to the zone of the learner's latest answer" },
};

const FILTERS = {
  trainer: { type: "string", enum: [...TRAINERS], description: "review = «Повторение» flashcards (self-ratings), active = «Активно» written/listening/spoken, nouns = articles/plurals/translations, verbs = forms/conjugations/translations/sentences, adjectives = endings, prepositions = cases" },
  checks: { type: "string", enum: [...CHECKS], description: "What was tested" },
  word: { type: "string", description: "Word or part of it" },
  outcome: { type: "string", enum: [...OUTCOMES] },
  only_errors: { type: "boolean", description: "Only incorrect, typo and «не знаю»" },
  // Pronoun practice (trainer: "pronouns") — read from each task's own record.
  case: { type: "string", enum: ["accusative"], description: "Pronoun practice: grammatical case (only accusative exists in this version)" },
  response_mode: { type: "string", enum: ["choice", "gaps", "written", "spoken"], description: "Pronoun practice: how the answer was given" },
  construction: { type: "string", enum: ["statement", "question", "negation", "modal", "separable", "prep_auf", "noun_replacement"], description: "Pronoun practice: tasks that used this construction" },
  verb: { type: "string", description: "Pronoun practice: verb id or infinitive (sehen, hören, abholen, warten auf…)" },
  role: { type: "string", enum: ["subject", "object"], description: "Pronoun practice: with pronoun — the pronoun in this role; alone — tasks focused on this role" },
  pronoun: { type: "string", description: "Pronoun practice: ich, du, er, sie_sg, es, wir, ihr, sie_pl, Sie — accusative forms (uns, euch) and sie_plural / sie_polite also accepted. A bare «sie» is ambiguous and ignored." },
};

export const TRAINING_TOOLS: McpToolDef[] = [
  {
    name: "get_training_summary",
    title: "Как прошла тренировка",
    description:
      "Exact numbers for a period of trainer practice («как сегодня прошли артикли и спряжения?»), counted from every recorded answer in the learner's own time zone: tasks and unique words, checked answers, first-try correct and first-try accuracy (a hint or a peeked answer does not count as first-try success), typos apart from wrong answers, «не знаю», skipped, technical errors, corrections after an error, by trainer and by what was checked; the concrete difficult articles, plurals, verb forms (which form), conjugations (pronoun + tense), adjective endings, preposition cases and translations with the learner's answer and the right one; repeated errors; a day-by-day trend; and per word what each kind of knowledge shows — translation, article, verb form, conjugation, use in a sentence — kept apart. Flashcard self-ratings are reported separately and never as correct answers. History exists only from when logging shipped (2026-10-03). With trainer \"pronouns\" (or whenever pronoun practice happened in the period) a `pronouns` block adds: checked first answers and how many were right, first independent (written/spoken) answers apart from choice/gaps, accuracy per answer part (subject, object, conjugation, sentence_type, word_order, government, separable_prefix, negation, spelling), per response mode, a confusion matrix «expected → answered» per role, hints, corrections, technical problems and answers awaiting review, a day-by-day trend, coverage of pronouns/verbs/constructions, delayed checks, per-difficulty mastery (recognition / written / spoken kept apart; «confident» only after independent answers in several sessions and verbs) and recent concrete difficulties with the first answer, the explanation and the correction. Teacher re-grades (submit_pronoun_answer_review) replace the automatic verdict in these figures. Filters: case, response_mode, construction, verb, role, pronoun.",
    inputSchema: { type: "object", properties: { ...PERIOD, ...FILTERS }, additionalProperties: false },
    annotations: { ...READ_ONLY, title: "Как прошла тренировка" },
  },
  {
    name: "get_training_history",
    title: "История ответов в тренажёрах",
    description:
      "Every recorded trainer answer, newest first, with filters (period/dates, trainer, what was checked, word, outcome, only_errors) and pagination (limit up to 200, offset; next_offset when there is more). Each event: time, trainer and mode, word and its dictionary entry or card id, what was checked (and which form / pronoun + tense), the prompt, the learner's answer and the right one, the outcome, whether it was the first try, hint used, answer shown, and a flashcard self-rating where that is what it was. Every event has event_id (use it with submit_pronoun_answer_review). Pronoun practice events add pronoun_task: the target subject/object (person, number, gender, case), expected forms, each answer part's verdict, the confusions, the explanation shown, whether this was the first answer or a correction (correction_of), delayed-review flags, speech transcript and confidence, active answer time, how it was checked (rules / teacher) and every re-grade. Pronoun filters: case, response_mode, construction, verb, role, pronoun.",
    inputSchema: {
      type: "object",
      properties: {
        ...PERIOD,
        ...FILTERS,
        limit: { type: "number", description: "1–200, default 50" },
        offset: { type: "number", description: "From next_offset of the previous page" },
      },
      additionalProperties: false,
    },
    annotations: { ...READ_ONLY, title: "История ответов в тренажёрах" },
  },
];

export const TRAINING_HANDLERS: Record<string, (ctx: Ctx, args: Args) => Promise<unknown>> = {
  get_training_summary: (ctx, args) => trainingSummary(ctx.admin, ctx.userId, args),
  get_training_history: (ctx, args) => trainingHistory(ctx.admin, ctx.userId, args),
};
