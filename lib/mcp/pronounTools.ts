// MCP tools for steering «Личные местоимения» in Практика: read and change
// which blocks are on, assign a session with a focus, and re-grade an answer
// the rules judged wrongly. Results are read with get_training_summary /
// get_training_history (trainer: "pronouns") — no second analytics system.

import type { SupabaseClient } from "@supabase/supabase-js";
import { catalogueDescription, createSession, listSessions, readConfig, reviewAnswer, writeConfig } from "@/lib/pronouns/store";
import type { McpToolDef } from "@/lib/mcp/tools";

type Ctx = { admin: SupabaseClient; userId: string; origin: string };
type Args = Record<string, unknown>;

const PRONOUN_LIST = { type: "array", items: { type: "string" }, description: "ich, du, er, sie_sg, es, wir, ihr, sie_pl, Sie — or accusative forms / brief names: uns, euch, sie_plural, sie_polite" };
const CONSTRUCTION_LIST = { type: "array", items: { type: "string", enum: ["statement", "question", "negation", "modal", "separable", "prep_auf", "noun_replacement"] } };
const MODE_LIST = { type: "array", items: { type: "string", enum: ["choice", "gaps", "written", "spoken", "tap", "build"] } };
const FOCUS_LIST = { type: "array", items: { type: "string", enum: ["object_pronouns", "subject_pronouns", "role_distinction"] } };
const VERB_LIST = { type: "array", items: { type: "string" }, description: "Verb ids or infinitives from get_pronoun_practice_config: sehen, hören, kennen, suchen, finden, brauchen, anrufen, abholen, prüfen, reparieren, kaufen, mitbringen, mitnehmen, warten (auf)" };

export const PRONOUN_TOOLS: McpToolDef[] = [
  {
    name: "get_pronoun_practice_config",
    title: "Настройки тренировки местоимений",
    description:
      "Read the «Личные местоимения» trainer in Практика: the learner's current settings (case, switched-on constructions/levels, verbs, response modes, focus, target pronouns, hints before the first answer, session length, delayed review), the whole supported catalogue (pronouns, constructions and the 7 levels, verbs with prefix/preposition/object types/natural sentence types and government notes, nouns for replacement, answer components) with its limits, and the sessions assigned so far with their links and status. Read this before update_pronoun_practice_config or create_pronoun_practice_session.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, title: "Настройки тренировки местоимений" },
  },
  {
    name: "update_pronoun_practice_config",
    title: "Изменить настройки местоимений",
    description:
      "Switch blocks of the pronoun trainer on or off once the learner has covered them — e.g. add «separable» with abholen/anrufen after the lesson on separable verbs, or «prep_auf» for warten auf. Only the fields given change; everything is validated against the catalogue (unknown verbs, Dativ, an empty set of sentence types are refused with the reason) and verbs that cannot be used with the enabled blocks are reported as warnings. Returns the new and previous config.",
    inputSchema: {
      type: "object",
      properties: {
        constructions: { ...CONSTRUCTION_LIST, description: "Full list of switched-on blocks" },
        verbs: { ...VERB_LIST, description: "Full list of verbs the learner knows" },
        modes: { ...MODE_LIST, description: "Response modes the learner's own sessions use; choice is used for addressing a difficulty after an error" },
        focus: FOCUS_LIST,
        target_pronouns: { ...PRONOUN_LIST, description: "Pronouns to weight up; [] for all equally" },
        hints_before_first_answer: { type: "boolean" },
        session_length: { type: "number", description: "4–40 tasks" },
        include_delayed_review: { type: "boolean", description: "Bring back earlier difficulties in later sessions" },
        case: { type: "string", enum: ["accusative"], description: "Only accusative exists in this version" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Изменить настройки местоимений" },
  },
  {
    name: "create_pronoun_practice_session",
    title: "Назначить тренировку местоимений",
    description:
      "Assign the learner a pronoun session of a given length and focus — e.g. a follow-up on «uns / euch / sie (они)» after a lesson. The app builds the tasks itself from the checked catalogue (you pick settings and difficulties, not sentences); a construction outside sentence_types/constructions is never drawn. Settings not given come from the learner's config. Returns a link to open the session in the app and any warnings (e.g. a verb whose block is off). The same client_key returns the existing session instead of a duplicate. The session appears in Практика → Личные местоимения. Results: get_training_summary {trainer: \"pronouns\"}.",
    inputSchema: {
      type: "object",
      properties: {
        client_key: { type: "string", description: "Your idempotency key, e.g. lesson-9-pronouns-followup" },
        case: { type: "string", enum: ["accusative"] },
        focus: FOCUS_LIST,
        target_pronouns: PRONOUN_LIST,
        verbs: VERB_LIST,
        sentence_types: { ...CONSTRUCTION_LIST, description: "statement, question, negation (and, if wanted, modal, separable, prep_auf, noun_replacement)" },
        response_mode: { type: "string", enum: ["choice", "gaps", "written", "spoken", "tap", "build", "mixed"], description: "mixed (default) alternates the learner's independent modes; tap = both pronouns picked from buttons (fast recognition); build = the sentence assembled from word buttons, with distractors" },
        item_count: { type: "number", description: "4–40; errors add short follow-ups on top" },
        hints_before_first_answer: { type: "boolean" },
        include_delayed_review: { type: "boolean", description: "Mix in earlier difficulties due for a delayed check" },
        note: { type: "string", description: "Shown to the learner above the session" },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Назначить тренировку местоимений" },
  },
  {
    name: "submit_pronoun_answer_review",
    title: "Пересмотреть оценку ответа",
    description:
      "Correct an automatic verdict on one pronoun practice answer — the rules marked a valid variant wrong, or an answer waits for review (outcome needs_review). Give event_id from get_training_history, and an outcome and/or per-part verdicts (subject, object, conjugation, sentence_type, word_order, government, separable_prefix, negation, spelling: correct | error | typo), with a note. The automatic verdict is kept; every review is kept; summaries count the latest one. Returns the automatic verdict and the review history.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "event_id from get_training_history" },
        outcome: { type: "string", enum: ["correct", "typo", "incorrect", "dont_know", "skipped", "technical", "needs_review"] },
        components: { type: "object", description: "e.g. {\"object\": \"correct\", \"word_order\": \"correct\"}", additionalProperties: { type: "string", enum: ["correct", "error", "typo"] } },
        note: { type: "string", description: "Why — shown in the history" },
      },
      required: ["event_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, title: "Пересмотреть оценку ответа" },
  },
];

export const PRONOUN_HANDLERS: Record<string, (ctx: Ctx, args: Args) => Promise<unknown>> = {
  get_pronoun_practice_config: async (ctx) => {
    const [current, sessions] = await Promise.all([readConfig(ctx.admin, ctx.userId), listSessions(ctx.admin, ctx.userId, ctx.origin)]);
    return { ...current, catalogue: catalogueDescription(), sessions };
  },
  update_pronoun_practice_config: (ctx, args) => writeConfig(ctx.admin, ctx.userId, args, "teacher"),
  create_pronoun_practice_session: (ctx, args) => createSession(ctx.admin, ctx.userId, args, ctx.origin),
  submit_pronoun_answer_review: (ctx, args) => reviewAnswer(ctx.admin, ctx.userId, args),
};
