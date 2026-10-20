// What the pronoun trainer is allowed to ask: switched on by the learner in
// the app or by the teacher over MCP, always checked against the catalogue.
//
// A block that is not switched on never appears — not through a random draw,
// not through a teacher's session that forgot to mention it. A session may ask
// for a narrower focus than the standing config, and may name verbs explicitly
// (the teacher's deliberate choice), but never a construction or case the
// catalogue does not support.

import {
  CONSTRUCTIONS,
  PRONOUN_IDS,
  RESPONSE_MODES,
  VERBS,
  VERB_BY_ID,
  verbUsable,
  type Construction,
  type PronounId,
  type ResponseMode,
} from "./catalog";

export const FOCUSES = ["object_pronouns", "subject_pronouns", "role_distinction"] as const;
export type Focus = typeof FOCUSES[number];

export const SUPPORTED_CASES = ["accusative"] as const;
export const PLANNED_CASES = ["dative"] as const;

export type PronounConfig = {
  version: 1;
  case: "accusative";
  constructions: Construction[];
  verbs: string[];
  modes: ResponseMode[];
  focus: Focus[];
  /** Pronouns to weight up; empty means every pronoun equally. */
  target_pronouns: PronounId[];
  hints_before_first_answer: boolean;
  session_length: number;
  include_delayed_review: boolean;
};

/** Aslan's starting point (brief §13): Akkusativ only, uns / euch / sie — их, sehen and hören, no hints. */
export const DEFAULT_CONFIG: PronounConfig = {
  version: 1,
  case: "accusative",
  constructions: ["statement", "question", "negation"],
  verbs: ["sehen", "hoeren"],
  modes: ["written", "spoken", "choice"],
  focus: ["object_pronouns", "role_distinction"],
  target_pronouns: ["wir", "ihr", "sie_pl"],
  hints_before_first_answer: false,
  session_length: 12,
  include_delayed_review: true,
};

export type SessionSettings = {
  client_key: string | null;
  case: "accusative";
  focus: Focus[];
  target_pronouns: PronounId[];
  verbs: string[];
  constructions: Construction[];
  response_mode: ResponseMode | "mixed";
  item_count: number;
  hints_before_first_answer: boolean;
  include_delayed_review: boolean;
  note: string | null;
};

export type Validation<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

/** Accept a target pronoun as the brief writes it: «uns», «sie_plural», «euch»… */
export function parsePronoun(raw: unknown): PronounId | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if ((PRONOUN_IDS as readonly string[]).includes(s)) return s as PronounId;
  const aliases: Record<string, PronounId> = {
    mich: "ich", dich: "du", ihn: "er", uns: "wir", euch: "ihr",
    sie_plural: "sie_pl", sie_pl: "sie_pl", "sie-plural": "sie_pl", "sie (они)": "sie_pl",
    sie_singular: "sie_sg", "sie (она)": "sie_sg", sie_formal: "Sie", sie_polite: "Sie", polite: "Sie",
  };
  return aliases[s] ?? aliases[s.toLowerCase()] ?? null;
}

const SENTENCE_TYPE_TO_CONSTRUCTION: Record<string, Construction> = {
  statement: "statement", question: "question", negation: "negation",
  modal: "modal", separable: "separable", prep_auf: "prep_auf", warten_auf: "prep_auf",
  noun_replacement: "noun_replacement",
};

function list<T extends string>(raw: unknown, allowed: readonly T[], what: string, errors: string[], map?: (s: string) => T | null): T[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) { errors.push(`${what} must be an array`); return undefined; }
  const out: T[] = [];
  for (const item of raw) {
    const value = map ? map(String(item)) : (allowed as readonly string[]).includes(String(item)) ? (String(item) as T) : null;
    if (!value) errors.push(`${what}: unknown value «${String(item)}». Supported: ${allowed.join(", ")}`);
    else if (!out.includes(value)) out.push(value);
  }
  return out;
}

function checkCase(raw: unknown, errors: string[]) {
  if (raw === undefined || raw === "accusative" || raw === "akkusativ") return;
  if (raw === "dative" || raw === "dativ") errors.push("case: Dativ is planned but not available in this version; only «accusative» is supported.");
  else errors.push(`case: unknown «${String(raw)}». Supported: accusative`);
}

function verbIds(raw: unknown, errors: string[]): string[] | undefined {
  return list(raw, VERBS.map((v) => v.id), "verbs", errors, (s) => {
    const key = s.trim().toLowerCase().replace("ö", "oe").replace("ü", "ue").replace(/\s+/g, "_");
    if (VERB_BY_ID[key]) return key;
    const byInfinitive = VERBS.find((v) => v.infinitive === s.trim().toLowerCase() && !v.preposition);
    return byInfinitive?.id ?? (key === "warten" ? "warten_auf" : null);
  });
}

/** Verbs no task can be built from with these blocks on; say so instead of failing silently. */
function unreachableVerbs(verbs: string[], constructions: Construction[]): string[] {
  return verbs.filter((id) => !verbUsable(VERB_BY_ID[id], constructions));
}

function blockHint(id: string): string {
  const v = VERB_BY_ID[id];
  const needs = [v.prefix ? "separable" : null, v.preposition ? "prep_auf" : null, !v.objects.includes("person") ? "noun_replacement" : null].filter(Boolean);
  return `${v.infinitive}${needs.length ? ` (needs ${needs.join(" + ")})` : ""}`;
}

/** A config patch from the app or MCP, merged onto the current config and validated. */
export function validateConfigPatch(current: PronounConfig, patch: Record<string, unknown>): Validation<PronounConfig> {
  const errors: string[] = [];
  const known = ["case", "constructions", "verbs", "modes", "focus", "target_pronouns", "hints_before_first_answer", "session_length", "include_delayed_review"];
  for (const key of Object.keys(patch)) if (!known.includes(key)) errors.push(`unknown setting «${key}»`);
  checkCase(patch.case, errors);
  const constructions = list(patch.constructions, CONSTRUCTIONS, "constructions", errors, (s) => SENTENCE_TYPE_TO_CONSTRUCTION[s] ?? null);
  const verbs = verbIds(patch.verbs, errors);
  const modes = list(patch.modes, RESPONSE_MODES, "modes", errors);
  const focus = list(patch.focus, FOCUSES, "focus", errors);
  const targets = list(patch.target_pronouns, PRONOUN_IDS, "target_pronouns", errors, parsePronoun);
  let length = current.session_length;
  if (patch.session_length !== undefined) {
    const n = Number(patch.session_length);
    if (!Number.isInteger(n) || n < 4 || n > 40) errors.push("session_length must be an integer 4–40");
    else length = n;
  }
  for (const flag of ["hints_before_first_answer", "include_delayed_review"] as const) {
    if (patch[flag] !== undefined && typeof patch[flag] !== "boolean") errors.push(`${flag} must be true or false`);
  }
  if (errors.length) return { ok: false, errors };

  const next: PronounConfig = {
    ...current,
    constructions: constructions ?? current.constructions,
    verbs: verbs ?? current.verbs,
    modes: modes ?? current.modes,
    focus: focus ?? current.focus,
    target_pronouns: targets ?? current.target_pronouns,
    hints_before_first_answer: typeof patch.hints_before_first_answer === "boolean" ? patch.hints_before_first_answer : current.hints_before_first_answer,
    include_delayed_review: typeof patch.include_delayed_review === "boolean" ? patch.include_delayed_review : current.include_delayed_review,
    session_length: length,
  };
  if (next.constructions.length === 0) return { ok: false, errors: ["at least one construction must stay on"] };
  if (!next.constructions.some((c) => c === "statement" || c === "question" || c === "negation")) {
    return { ok: false, errors: ["at least one sentence type (statement, question, negation) must stay on"] };
  }
  if (next.verbs.length === 0) return { ok: false, errors: ["at least one verb must stay on"] };
  if (next.modes.length === 0) return { ok: false, errors: ["at least one response mode must stay on"] };
  const warnings: string[] = [];
  const unreachable = unreachableVerbs(next.verbs, next.constructions);
  if (unreachable.length) warnings.push(`These verbs stay unused until their block is on: ${unreachable.map(blockHint).join(", ")}`);
  if (next.verbs.every((id) => unreachable.includes(id))) return { ok: false, errors: ["no enabled verb can be used with the enabled blocks", ...warnings] };
  return { ok: true, value: next, warnings };
}

/** Read a stored config back, tolerating an older or partial row. */
export function normalizeConfig(raw: unknown): PronounConfig {
  if (typeof raw !== "object" || raw === null) return DEFAULT_CONFIG;
  const result = validateConfigPatch(DEFAULT_CONFIG, Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(([k]) => k !== "version"),
  ));
  return result.ok ? result.value : DEFAULT_CONFIG;
}

/** A teacher's assignment (create_pronoun_practice_session), checked and filled from the standing config. */
export function validateSessionSettings(config: PronounConfig, raw: Record<string, unknown>): Validation<SessionSettings> {
  const errors: string[] = [];
  const known = ["client_key", "case", "focus", "target_pronouns", "verbs", "sentence_types", "constructions", "response_mode", "item_count", "hints_before_first_answer", "include_delayed_review", "note"];
  for (const key of Object.keys(raw)) if (!known.includes(key)) errors.push(`unknown setting «${key}»`);
  checkCase(raw.case, errors);
  const focus = list(raw.focus, FOCUSES, "focus", errors);
  const targets = list(raw.target_pronouns, PRONOUN_IDS, "target_pronouns", errors, parsePronoun);
  const verbs = verbIds(raw.verbs, errors);
  const fromTypes = list(raw.sentence_types, CONSTRUCTIONS, "sentence_types", errors, (s) => SENTENCE_TYPE_TO_CONSTRUCTION[s] ?? null);
  const fromConstructions = list(raw.constructions, CONSTRUCTIONS, "constructions", errors, (s) => SENTENCE_TYPE_TO_CONSTRUCTION[s] ?? null);
  let mode: SessionSettings["response_mode"] = "mixed";
  if (raw.response_mode !== undefined) {
    if (raw.response_mode === "mixed" || (RESPONSE_MODES as readonly string[]).includes(String(raw.response_mode))) mode = raw.response_mode as SessionSettings["response_mode"];
    else errors.push(`response_mode: unknown «${String(raw.response_mode)}». Supported: ${RESPONSE_MODES.join(", ")}, mixed`);
  }
  let count = config.session_length;
  if (raw.item_count !== undefined) {
    const n = Number(raw.item_count);
    if (!Number.isInteger(n) || n < 4 || n > 40) errors.push("item_count must be an integer 4–40");
    else count = n;
  }
  const key = raw.client_key === undefined ? null : typeof raw.client_key === "string" && raw.client_key.trim() ? raw.client_key.trim().slice(0, 120) : null;
  if (raw.client_key !== undefined && !key) errors.push("client_key must be a non-empty string");
  for (const flag of ["hints_before_first_answer", "include_delayed_review"] as const) {
    if (raw[flag] !== undefined && typeof raw[flag] !== "boolean") errors.push(`${flag} must be true or false`);
  }
  if (errors.length) return { ok: false, errors };

  const constructions = [...new Set([...(fromTypes ?? []), ...(fromConstructions ?? [])])];
  const settings: SessionSettings = {
    client_key: key,
    case: "accusative",
    focus: focus ?? config.focus,
    target_pronouns: targets ?? config.target_pronouns,
    verbs: verbs ?? config.verbs,
    constructions: constructions.length ? constructions : config.constructions,
    response_mode: mode,
    item_count: count,
    hints_before_first_answer: typeof raw.hints_before_first_answer === "boolean" ? raw.hints_before_first_answer : config.hints_before_first_answer,
    include_delayed_review: typeof raw.include_delayed_review === "boolean" ? raw.include_delayed_review : config.include_delayed_review,
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 500) : null,
  };
  if (!settings.constructions.some((c) => c === "statement" || c === "question" || c === "negation")) {
    settings.constructions = ["statement", ...settings.constructions];
  }
  const warnings: string[] = [];
  const unreachable = unreachableVerbs(settings.verbs, settings.constructions);
  if (unreachable.length === settings.verbs.length) {
    return { ok: false, errors: [`none of the verbs can be used with these blocks: ${unreachable.map(blockHint).join(", ")}`] };
  }
  if (unreachable.length) warnings.push(`Not used in this session (block off): ${unreachable.map((id) => VERB_BY_ID[id].infinitive).join(", ")}`);
  const offInConfig = settings.constructions.filter((c) => !config.constructions.includes(c));
  if (offInConfig.length) warnings.push(`This session uses blocks the standing config has off: ${offInConfig.join(", ")}. They apply to this session only.`);
  return { ok: true, value: settings, warnings };
}

/** The learner's own «Начать тренировку»: the standing config as a session. */
export function sessionFromConfig(config: PronounConfig): SessionSettings {
  return {
    client_key: null,
    case: "accusative",
    focus: config.focus,
    target_pronouns: config.target_pronouns,
    verbs: config.verbs,
    constructions: config.constructions,
    response_mode: "mixed",
    item_count: config.session_length,
    hints_before_first_answer: config.hints_before_first_answer,
    include_delayed_review: config.include_delayed_review,
    note: null,
  };
}
