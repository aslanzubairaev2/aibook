// Settings of the two grammar trainers: validated the same way whether the
// learner saves them in the app or the teacher changes them over MCP, and
// always checked against the catalogue — an unknown combination, a case the
// trainer has no tasks for, or a filter that leaves nothing to ask is refused
// or explained, never silently dropped.

import { CASES, FAMILIES, type Case, type Family, type Gender } from "./common";
import { ART_DEFAULT, BLOCKS, DATIVE_BLOCKS, FRAMES, artPlan, artPool, artRepeat, type ArtConfig, type Block } from "./articles";
import { MODES, TRAINER_IDS, type GrammarTask, type Mode, type TrainerId } from "./task";
import { COMBOS, SENTENCE_TYPES, VP_DEFAULT, VP_PREPOSITIONS, vpPlan, vpPool, vpRepeat, type VPConfig } from "./verbPrepositions";

export type GrammarConfig = VPConfig | ArtConfig;
export type Validation<T> = { ok: true; value: T; warnings: string[] } | { ok: false; errors: string[] };

export const TRAINER_TITLE: Record<TrainerId, string> = {
  verb_prepositions: "Глаголы и предлоги",
  articles_cases: "Артикли и падежи",
};

export const TRAINER_PATH: Record<TrainerId, string> = {
  verb_prepositions: "verb-prepositions",
  articles_cases: "articles",
};

export function parseTrainer(raw: unknown): TrainerId | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/-/g, "_");
  if ((TRAINER_IDS as readonly string[]).includes(s)) return s as TrainerId;
  if (s === "verb_preps" || s === "verbs_prepositions" || s === "prepositions") return "verb_prepositions";
  if (s === "articles" || s === "articles_and_cases" || s === "cases") return "articles_cases";
  return null;
}

export function defaultConfig(trainer: TrainerId): GrammarConfig {
  return trainer === "verb_prepositions" ? VP_DEFAULT : ART_DEFAULT;
}

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

function bool(raw: unknown, what: string, errors: string[]): boolean | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") { errors.push(`${what} must be true or false`); return undefined; }
  return raw;
}

function mode(raw: unknown, errors: string[]): Mode | "mixed" | undefined {
  if (raw === undefined) return undefined;
  if (raw === "mixed" || (MODES as readonly string[]).includes(String(raw))) return raw as Mode | "mixed";
  errors.push(`mode: unknown «${String(raw)}». Supported: ${MODES.join(", ")}, mixed`);
  return undefined;
}

function setSize(raw: unknown, errors: string[]): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 200) { errors.push("set_size must be 0 (endless) or 1–200"); return undefined; }
  return n;
}

const COMBO_IDS = COMBOS.map((c) => c.id);
const FRAME_IDS = FRAMES.map((f) => f.id);

/** A combination as a teacher may write it: «warten_auf», «warten auf», «sich freuen über». */
export function parseCombo(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss").replace(/\s*\+.*$/, "").replace(/\s+/g, "_");
  if (COMBO_IDS.includes(s)) return s;
  const found = COMBOS.find((c) => c.label.toLowerCase().replace(/\s*\+.*$/, "").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/\s+/g, "_") === s);
  return found?.id ?? null;
}

function parseCase(s: string): Case | null {
  const v = s.trim().toLowerCase();
  if (v === "nom" || v === "nominativ" || v === "nominative") return "nom";
  if (v === "acc" || v === "akk" || v === "akkusativ" || v === "accusative") return "acc";
  if (v === "dat" || v === "dativ" || v === "dative") return "dat";
  return null;
}

function parsePrep(s: string): string | null {
  const v = s.trim().toLowerCase().replace("ue", "ü");
  return VP_PREPOSITIONS.includes(v) ? v : null;
}

/** A patch from the app or MCP, merged onto the current config and validated. */
export function validatePatch(trainer: TrainerId, current: GrammarConfig, patch: Record<string, unknown>): Validation<GrammarConfig> {
  return trainer === "verb_prepositions" ? validateVP(current as VPConfig, patch) : validateArt(current as ArtConfig, patch);
}

function validateVP(current: VPConfig, patch: Record<string, unknown>): Validation<VPConfig> {
  const errors: string[] = [];
  const known = ["selection", "learned", "learned_add", "learned_remove", "manual", "prepositions", "cases", "include_no_prep", "reflexive", "separable", "modal", "sentence_types", "objects", "mode", "set_size"];
  for (const k of Object.keys(patch)) if (!known.includes(k)) errors.push(`unknown setting «${k}». Known: ${known.join(", ")}`);
  const selection = patch.selection === undefined ? undefined : patch.selection === "learned" || patch.selection === "manual" ? patch.selection : (errors.push("selection must be learned or manual"), undefined);
  const learned = list(patch.learned, COMBO_IDS, "learned", errors, parseCombo);
  const add = list(patch.learned_add, COMBO_IDS, "learned_add", errors, parseCombo);
  const remove = list(patch.learned_remove, COMBO_IDS, "learned_remove", errors, parseCombo);
  const manual = list(patch.manual, COMBO_IDS, "manual", errors, parseCombo);
  const prepositions = list(patch.prepositions, VP_PREPOSITIONS, "prepositions", errors, parsePrep);
  const cases = list(patch.cases, ["acc", "dat"] as const, "cases", errors, (s) => { const c = parseCase(s); return c === "acc" || c === "dat" ? c : null; });
  const sentence = list(patch.sentence_types, SENTENCE_TYPES, "sentence_types", errors);
  const objects = list(patch.objects, ["pronoun", "noun"] as const, "objects", errors);
  const m = mode(patch.mode, errors);
  const size = setSize(patch.set_size, errors);
  const flags = {
    include_no_prep: bool(patch.include_no_prep, "include_no_prep", errors),
    reflexive: bool(patch.reflexive, "reflexive", errors),
    separable: bool(patch.separable, "separable", errors),
    modal: bool(patch.modal, "modal", errors),
  };
  if (errors.length) return { ok: false, errors };
  let learnedNext = learned ?? current.learned;
  if (add) learnedNext = [...new Set([...learnedNext, ...add])];
  if (remove) learnedNext = learnedNext.filter((id) => !remove.includes(id));
  const next: VPConfig = {
    ...current,
    selection: (selection as VPConfig["selection"]) ?? current.selection,
    learned: COMBO_IDS.filter((id) => learnedNext.includes(id)),
    manual: manual ?? current.manual,
    prepositions: prepositions ?? current.prepositions,
    cases: cases ?? current.cases,
    sentence_types: sentence ?? current.sentence_types,
    objects: objects ?? current.objects,
    mode: m ?? current.mode,
    set_size: size ?? current.set_size,
    include_no_prep: flags.include_no_prep ?? current.include_no_prep,
    reflexive: flags.reflexive ?? current.reflexive,
    separable: flags.separable ?? current.separable,
    modal: flags.modal ?? current.modal,
  };
  if (!next.cases.length) return { ok: false, errors: ["cases: at least one of acc, dat must stay on"] };
  if (!next.sentence_types.length) return { ok: false, errors: ["sentence_types: at least one must stay on"] };
  if (!next.objects.length) return { ok: false, errors: ["objects: pronoun, noun or both"] };
  const { combos, reasons } = vpPool(next);
  return { ok: true, value: next, warnings: combos.length ? [] : [`With these settings no task can be built: ${reasons.join(" ")}`] };
}

function validateArt(current: ArtConfig, patch: Record<string, unknown>): Validation<ArtConfig> {
  const errors: string[] = [];
  const known = ["cases", "dative_blocks", "genders", "families", "show_gender", "gaps", "selection", "learned", "learned_add", "learned_remove", "manual", "mode", "set_size"];
  for (const k of Object.keys(patch)) if (!known.includes(k)) errors.push(`unknown setting «${k}». Known: ${known.join(", ")}`);
  const cases = list(patch.cases, CASES, "cases", errors, parseCase);
  const dativeBlocks = list(patch.dative_blocks, DATIVE_BLOCKS, "dative_blocks", errors, (s) => {
    const v = s.trim().toLowerCase();
    const id = v.startsWith("dat_") ? v : `dat_${v}`;
    return (DATIVE_BLOCKS as string[]).includes(id) ? id as Block : null;
  });
  const genders = list(patch.genders, ["m", "f", "n", "pl"] as const, "genders", errors, (s) => {
    const v = s.trim().toLowerCase();
    const map: Record<string, Gender> = { m: "m", masculine: "m", der: "m", f: "f", feminine: "f", n: "n", neuter: "n", das: "n", pl: "pl", plural: "pl" };
    return map[v] ?? null;
  });
  const families = list(patch.families, FAMILIES, "families", errors, (s) => {
    const v = s.trim();
    if ((FAMILIES as readonly string[]).includes(v)) return v as Family;
    const lower = v.toLowerCase();
    if (lower === "definite" || lower === "die" || lower === "das") return "der";
    if (lower === "indefinite" || lower === "eine") return "ein";
    if (lower === "negative" || lower === "keine") return "kein";
    if (lower === "ihr_polite" || lower === "polite") return "Ihr";
    return (FAMILIES as readonly string[]).includes(lower) ? lower as Family : null;
  });
  const gaps = patch.gaps === undefined ? undefined : patch.gaps === "one" || patch.gaps === "two" || patch.gaps === "mixed" || patch.gaps === 1 || patch.gaps === 2
    ? (patch.gaps === 1 ? "one" : patch.gaps === 2 ? "two" : patch.gaps) as ArtConfig["gaps"] : (errors.push("gaps must be one, two or mixed"), undefined);
  const selection = patch.selection === undefined ? undefined : patch.selection === "learned" || patch.selection === "manual" ? patch.selection : (errors.push("selection must be learned or manual"), undefined);
  const learned = list(patch.learned, FRAME_IDS, "learned", errors);
  const add = list(patch.learned_add, FRAME_IDS, "learned_add", errors);
  const remove = list(patch.learned_remove, FRAME_IDS, "learned_remove", errors);
  const manual = list(patch.manual, FRAME_IDS, "manual", errors);
  const show = bool(patch.show_gender, "show_gender", errors);
  const m = mode(patch.mode, errors);
  const size = setSize(patch.set_size, errors);
  if (errors.length) return { ok: false, errors };
  let learnedNext = learned ?? current.learned;
  if (add) learnedNext = [...new Set([...learnedNext, ...add])];
  if (remove) learnedNext = learnedNext.filter((id) => !remove.includes(id));
  const next: ArtConfig = {
    ...current,
    cases: cases ? CASES.filter((c) => cases.includes(c)) : current.cases,
    dative_blocks: dativeBlocks ?? current.dative_blocks,
    genders: genders ?? current.genders,
    families: families ? FAMILIES.filter((fm) => families.includes(fm)) : current.families,
    show_gender: show ?? current.show_gender,
    gaps: gaps ?? current.gaps,
    selection: (selection as ArtConfig["selection"]) ?? current.selection,
    learned: FRAME_IDS.filter((id) => learnedNext.includes(id)),
    manual: manual ?? current.manual,
    mode: m ?? current.mode,
    set_size: size ?? current.set_size,
  };
  if (!next.cases.length) return { ok: false, errors: ["cases: at least one case must stay on"] };
  if (!next.genders.length) return { ok: false, errors: ["genders: at least one of m, f, n, pl"] };
  if (!next.families.length) return { ok: false, errors: ["families: at least one determiner family"] };
  const { frames, reasons } = artPool(next);
  return { ok: true, value: next, warnings: frames.length ? [] : [`With these settings no task can be built: ${reasons.join(" ")}`] };
}

/** A stored config read back, tolerating an older or partial row. */
export function normalizeConfig(trainer: TrainerId, raw: unknown): GrammarConfig {
  const base = defaultConfig(trainer);
  if (typeof raw !== "object" || raw === null) return base;
  const patch = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([k]) => k !== "version"));
  const result = validatePatch(trainer, base, patch);
  return result.ok ? result.value : base;
}

/** Why the current settings give no tasks, or [] when they do. */
export function emptyReasons(trainer: TrainerId, config: GrammarConfig): string[] {
  if (trainer === "verb_prepositions") { const p = vpPool(config as VPConfig); return p.combos.length ? [] : p.reasons; }
  const p = artPool(config as ArtConfig);
  return p.frames.length ? [] : p.reasons;
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/** A teacher's assignment or the learner's own start: the config plus a mode, a length and a note. */
export type SessionSettings = {
  client_key: string | null;
  config: GrammarConfig;
  mode: Mode | "mixed";
  /** 0 = endless. */
  item_count: number;
  note: string | null;
};

export function validateSession(trainer: TrainerId, config: GrammarConfig, raw: Record<string, unknown>): Validation<SessionSettings> {
  const errors: string[] = [];
  const own = ["client_key", "mode", "item_count", "note", "config"];
  // Session fields and config overrides may come flat or under «config».
  const overrides: Record<string, unknown> = { ...(typeof raw.config === "object" && raw.config ? raw.config as Record<string, unknown> : {}) };
  for (const [k, v] of Object.entries(raw)) if (!own.includes(k)) overrides[k] = v;
  delete overrides.mode;
  delete overrides.set_size;
  const merged = validatePatch(trainer, config, overrides);
  if (!merged.ok) return merged;
  const m = mode(raw.mode, errors);
  let count = 10;
  if (raw.item_count !== undefined) {
    const n = Number(raw.item_count);
    if (!Number.isInteger(n) || n < 0 || n > 200) errors.push("item_count must be 0 (endless) or 1–200");
    else count = n;
  }
  const key = raw.client_key === undefined ? null : typeof raw.client_key === "string" && raw.client_key.trim() ? raw.client_key.trim().slice(0, 120) : (errors.push("client_key must be a non-empty string"), null);
  if (errors.length) return { ok: false, errors };
  const reasons = emptyReasons(trainer, merged.value);
  if (reasons.length) return { ok: false, errors: [`No task can be built with these settings: ${reasons.join(" ")}`] };
  return {
    ok: true,
    value: { client_key: key, config: merged.value, mode: m ?? merged.value.mode, item_count: count, note: typeof raw.note === "string" && raw.note.trim() ? raw.note.trim().slice(0, 500) : null },
    warnings: merged.warnings,
  };
}

// ─── Planning, by trainer ────────────────────────────────────────────────────

const ROTATION: Mode[] = ["build", "written", "quick"];

/** The mode of the n-th task: one mode, or «mixed» rotating build → written → quick (spoken stays a deliberate choice). */
export function modeAt(m: Mode | "mixed", n: number, speech: boolean): Mode {
  const chosen = m === "mixed" ? ROTATION[n % ROTATION.length] : m;
  return chosen === "spoken" && !speech ? "written" : chosen;
}

export function planTasks(trainer: TrainerId, config: GrammarConfig, args: { mode: Mode | "mixed"; count: number; seed: number; newId: () => string; due?: string[]; offset?: number; speech?: boolean; avoid?: string | null }): GrammarTask[] {
  const out: GrammarTask[] = [];
  // One mode per call keeps the planner simple; mixed draws task by task.
  const due = [...(args.due ?? [])];
  for (let i = 0; i < args.count; i++) {
    const n = (args.offset ?? 0) + i;
    const m = modeAt(args.mode, n, args.speech !== false);
    // Earlier difficulties come back at every third task: 2nd, 5th, 8th…
    const dueKey = n % 3 === 1 ? due.shift() : undefined;
    const avoid = out.length ? String(out[out.length - 1].meta.combo ?? out[out.length - 1].meta.frame) : args.avoid ?? null;
    const plan = (key?: string) => trainer === "verb_prepositions"
      ? vpPlan({ config: config as VPConfig, mode: m, count: 1, seed: args.seed + i * 7919, newId: args.newId, due: key ? [key] : undefined, forceDue: Boolean(key), avoidCombo: avoid })
      : artPlan({ config: config as ArtConfig, mode: m, count: 1, seed: args.seed + i * 7919, newId: args.newId, due: key ? [key] : undefined, forceDue: Boolean(key), avoidFrame: avoid });
    let one = plan(dueKey);
    if (!one.length && dueKey) one = plan();
    if (one.length) out.push(one[0]);
    else if (i === 0) return [];
  }
  return out;
}

export function repeatTask(trainer: TrainerId, task: GrammarTask, config: GrammarConfig, seed: number, newId: () => string): GrammarTask | null {
  return trainer === "verb_prepositions" ? vpRepeat(task, config as VPConfig, seed, newId) : artRepeat(task, config as ArtConfig, seed, newId);
}

export { BLOCKS };
