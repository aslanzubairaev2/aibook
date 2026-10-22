// MCP tools for steering the two grammar trainers in Практика —
// «Глаголы и предлоги» (verb_prepositions) and «Артикли и падежи»
// (articles_cases): read the catalogue and settings, mark constructions
// learned and change the selection, assign a session with a link. Results are
// read with get_training_summary / get_training_history — no second
// analytics system.

import type { SupabaseClient } from "@supabase/supabase-js";
import { parseTrainer } from "@/lib/grammar/config";
import { catalogueDescription, createSession, listSessions, readConfig, writeConfig } from "@/lib/grammar/store";
import { emptyReasons } from "@/lib/grammar/config";
import type { McpToolDef } from "@/lib/mcp/tools";

type Ctx = { admin: SupabaseClient; userId: string; origin: string };
type Args = Record<string, unknown>;

const TRAINER = { type: "string", enum: ["verb_prepositions", "articles_cases"], description: "verb_prepositions = «Глаголы и предлоги»; articles_cases = «Артикли и падежи»" };
const MODE = { type: "string", enum: ["quick", "build", "written", "spoken", "mixed"], description: "quick = choose from buttons (recognition), build = assemble the sentence from word buttons with distractors, written = type the translation, spoken = say it; mixed rotates build → written → quick" };
const STRINGS = { type: "array", items: { type: "string" } };

const SETTINGS = {
  // verb_prepositions
  selection: { type: "string", enum: ["learned", "manual"], description: "Both trainers: draw from the learned list or the manual list" },
  learned: { ...STRINGS, description: "Both trainers: the full learned list (verb_prepositions: combination ids like warten_auf, sprechen_mit; articles_cases: frame ids like brauchen, mit_sprechen)" },
  learned_add: { ...STRINGS, description: "Mark these learned, keeping the rest" },
  learned_remove: { ...STRINGS, description: "Unmark these" },
  manual: { ...STRINGS, description: "The manual selection" },
  prepositions: { ...STRINGS, description: "verb_prepositions: only real combinations with these prepositions ([] = all)" },
  cases: { ...STRINGS, description: "verb_prepositions: acc, dat (case of the object). articles_cases: nom, acc, dat" },
  include_no_prep: { type: "boolean", description: "verb_prepositions: mix in verbs without a preposition" },
  reflexive: { type: "boolean", description: "verb_prepositions: reflexive verbs block" },
  separable: { type: "boolean", description: "verb_prepositions: separable verbs block" },
  modal: { type: "boolean", description: "verb_prepositions: sentences with können" },
  sentence_types: { ...STRINGS, description: "verb_prepositions: statement, question, negation" },
  objects: { ...STRINGS, description: "verb_prepositions: pronoun, noun" },
  // articles_cases
  dative_blocks: { ...STRINGS, description: "articles_cases: dat_mit, dat_bei, dat_zu, dat_verbs, dat_give — used only while dat is on" },
  genders: { ...STRINGS, description: "articles_cases: m, f, n, pl" },
  families: { ...STRINGS, description: "articles_cases: der, ein, kein, mein, dein, sein, ihr, unser, euer, Ihr" },
  show_gender: { type: "boolean", description: "articles_cases: show the noun's article in tasks" },
  gaps: { type: "string", enum: ["one", "two", "mixed"], description: "articles_cases: one or two missing determiners" },
  mode: MODE,
  set_size: { type: "number", description: "0 = endless practice; otherwise tasks per set" },
};

export const GRAMMAR_TOOLS: McpToolDef[] = [
  {
    name: "get_grammar_trainer_config",
    title: "Настройки тренажёра грамматики",
    description:
      "Read «Глаголы и предлоги» (trainer verb_prepositions) or «Артикли и падежи» (articles_cases) in Практика: the learner's settings (learned constructions and the selection, filters, mode, set size), whether they give any tasks and why not, the whole catalogue — for verb_prepositions every combination in one meaning with preposition, case, level, required grammar topics, examples and contrasts (sprechen mit / über), plus verbs without a preposition; for articles_cases every sentence frame with its case, block and allowed determiner families, and the nouns — the error types and answer kinds the history reports, the limits, and the sessions assigned so far with their links. Read this before update_grammar_trainer_config or create_grammar_trainer_session.",
    inputSchema: { type: "object", properties: { trainer: TRAINER }, required: ["trainer"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false, title: "Настройки тренажёра грамматики" },
  },
  {
    name: "update_grammar_trainer_config",
    title: "Изменить тренажёр грамматики",
    description:
      "Change a grammar trainer's standing settings once the learner has covered something — e.g. learned_add [\"sprechen_mit\", \"denken_an\"] after a lesson on verbs with prepositions, reflexive true, or for articles cases [\"nom\", \"acc\", \"dat\"] with dative_blocks [\"dat_mit\"]. Only the fields given change; everything is validated against the catalogue (unknown combinations, a preposition with no real combination, Dativ blocks… are refused with the reason). A preposition filter selects real combinations, it never attaches a preposition to another verb. Returns the new and previous config, and empty_reasons when the settings would give no tasks.",
    inputSchema: { type: "object", properties: { trainer: TRAINER, ...SETTINGS }, required: ["trainer"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Изменить тренажёр грамматики" },
  },
  {
    name: "create_grammar_trainer_session",
    title: "Назначить тренировку грамматики",
    description:
      "Assign the learner a session in «Глаголы и предлоги» or «Артикли и падежи» and get a link that opens it in the app. Settings given here (same names as update_grammar_trainer_config, e.g. manual + selection manual, prepositions, cases, families, mode) apply to this session only; the rest comes from the learner's config. item_count 0 = endless practice until the learner stops; otherwise a set without a timer (repeats after errors are shown apart, the count is not stretched). Tasks are built by the app from the checked catalogue — you choose constructions and settings, not sentences. The same client_key returns the existing session. Results: get_training_summary {trainer} → grammar_trainers; get_training_history {trainer, response_mode, answer_kind, error_type, construction_key}.",
    inputSchema: {
      type: "object",
      properties: {
        trainer: TRAINER,
        client_key: { type: "string", description: "Your idempotency key, e.g. lesson-12-verbs-prepositions" },
        item_count: { type: "number", description: "0 = endless; 1–200 = a set" },
        note: { type: "string", description: "Shown to the learner above the session" },
        ...SETTINGS,
      },
      required: ["trainer"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, title: "Назначить тренировку грамматики" },
  },
];

function trainerArg(args: Args) {
  const trainer = parseTrainer(args.trainer);
  if (!trainer) throw new Error("trainer must be verb_prepositions or articles_cases");
  const rest = { ...args };
  delete rest.trainer;
  return { trainer, rest };
}

export const GRAMMAR_HANDLERS: Record<string, (ctx: Ctx, args: Args) => Promise<unknown>> = {
  get_grammar_trainer_config: async (ctx, args) => {
    const { trainer } = trainerArg(args);
    const [current, sessions] = await Promise.all([readConfig(ctx.admin, ctx.userId, trainer), listSessions(ctx.admin, ctx.userId, ctx.origin, { trainer })]);
    return { ...current, empty_reasons: emptyReasons(trainer, current.config), catalogue: catalogueDescription(trainer), sessions };
  },
  update_grammar_trainer_config: (ctx, args) => {
    const { trainer, rest } = trainerArg(args);
    return writeConfig(ctx.admin, ctx.userId, trainer, rest, "teacher");
  },
  create_grammar_trainer_session: (ctx, args) => {
    const { trainer, rest } = trainerArg(args);
    return createSession(ctx.admin, ctx.userId, trainer, rest, ctx.origin);
  },
};
