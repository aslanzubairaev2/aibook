// Building tasks out of the catalogue: the German target, the Russian prompt,
// and a session's sequence — with the adaptive repeats the brief asks for.
//
// Pure and seeded, so a test can say exactly what a session looks like.

import {
  MODAL,
  NOUNS,
  NOUN_BY_ID,
  PEOPLE_PRONOUNS,
  PRONOUNS,
  RU_THING_ACC,
  TEMPLATE_VERSION,
  VERBS,
  VERB_BY_ID,
  articleFor,
  constructionsNeeded,
  pronounForNoun,
  type Construction,
  type NounInfo,
  type PronounId,
  type ResponseMode,
  type VerbInfo,
} from "./catalog";
import type { Focus, SessionSettings } from "./config";

export type SentenceType = "statement" | "question" | "negation";
export type Role = "subject" | "object";
export type Slot = "S" | "V" | "O" | "NICHT" | "AUF" | "PREFIX" | "INF";

export type TaskSpec = {
  kind: "people" | "noun";
  verb: string;
  sentenceType: SentenceType;
  modal: boolean;
  subject: PronounId;
  /** For a noun task: the pronoun its German gender calls for. */
  object: PronounId;
  noun: string | null;
};

export type PronounTask = TaskSpec & {
  id: string;
  template_version: string;
  mode: ResponseMode;
  constructions: Construction[];
  prompt_ru: string;
  /** What makes «вы», «Вы» and «она/они» unambiguous. */
  notes_ru: string[];
  /** A noun task: the German sentence that introduces the noun, given. */
  context_de: string | null;
  context_ru: string | null;
  expected: string;
  tokens: { slot: Slot; text: string }[];
  /** Hidden in choice and gaps modes. */
  blanks: Role[];
  options: string[] | null;
  /** tap / build: the buttons, in the order shown. */
  bank: string[] | null;
  focus_role: Role;
  /** What this task is evidence about, e.g. «object:wir». */
  difficulty: string;
  delayed_review: boolean;
  followup_of: string | null;
  recheck_of: string | null;
  government_note: string | null;
};

// ─── Random, seeded ──────────────────────────────────────────────────────────

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

function pick<T>(items: T[], weights: number[], random: () => number): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// ─── Sentences ───────────────────────────────────────────────────────────────

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** The German sentence, slot by slot. */
export function buildGerman(spec: TaskSpec): { tokens: { slot: Slot; text: string }[]; text: string } {
  const verb = VERB_BY_ID[spec.verb];
  const subj = PRONOUNS[spec.subject];
  const obj = PRONOUNS[spec.object];
  const finite = spec.modal ? MODAL.present[subj.de] : verb.present[subj.de];
  const S = { slot: "S" as const, text: subj.nom };
  const V = { slot: "V" as const, text: finite };
  const objectPart: { slot: Slot; text: string }[] = verb.preposition
    ? [{ slot: "AUF", text: verb.preposition }, { slot: "O", text: obj.acc }]
    : [{ slot: "O", text: obj.acc }];
  const nicht = spec.sentenceType === "negation" ? [{ slot: "NICHT" as const, text: "nicht" }] : [];
  // nicht stands before a prepositional object and after a pronoun object.
  const middle = verb.preposition ? [...nicht, ...objectPart] : [...objectPart, ...nicht];
  const tail: { slot: Slot; text: string }[] = spec.modal
    ? [{ slot: "INF", text: verb.infinitive }]
    : verb.prefix ? [{ slot: "PREFIX", text: verb.prefix }] : [];
  const head = spec.sentenceType === "question" ? [V, S] : [S, V];
  const tokens = [...head, ...middle, ...tail];
  const words = tokens.map((t, i) => (i === 0 ? cap(t.text) : t.text));
  return { tokens, text: `${words.join(" ")}${spec.sentenceType === "question" ? "?" : "."}` };
}

function ruObject(verb: VerbInfo, spec: TaskSpec): string {
  if (spec.noun) return RU_THING_ACC[NOUN_BY_ID[spec.noun].ruGender];
  const o = PRONOUNS[spec.object];
  return verb.ruObject === "dat" ? o.ruDat : verb.ruObject === "prep" ? o.ruPrep : o.ruAcc;
}

/** The Russian prompt the learner translates, and what keeps it unambiguous. */
export function buildRussian(spec: TaskSpec): { text: string; notes: string[] } {
  const verb = VERB_BY_ID[spec.verb];
  const subj = PRONOUNS[spec.subject];
  const obj = ruObject(verb, spec);
  const after = verb.ruAfter ? ` ${verb.ruAfter}` : "";
  const ne = spec.sentenceType === "negation" ? "не " : "";
  const body = spec.modal
    ? `${subj.ruNom} ${ne}${MODAL.ruPresent[subj.ru]} ${verb.ruInfinitive} ${obj}${after}`
    : `${subj.ruNom} ${ne}${verb.ruPresent[subj.ru]} ${obj}${after}`;
  const text = `${cap(body)}${spec.sentenceType === "question" ? "?" : "."}`;
  const notes: string[] = [];
  if (spec.subject === "ihr") notes.push("вы — несколько друзей");
  if (spec.subject === "Sie") notes.push("Вы — вежливое обращение");
  if (!spec.noun && spec.object === "ihr") notes.push(`${obj} — несколько друзей`);
  if (!spec.noun && spec.object === "Sie") notes.push(`${obj} — вежливое обращение`);
  return { text, notes };
}

function nounContext(noun: NounInfo, verb: VerbInfo): { de: string; ru: string } {
  const be = noun.gender === "pl" ? "sind" : "ist";
  const nom = `${cap(articleFor(noun, "nom"))} ${noun.de}`;
  if (verb.id === "suchen" || verb.id === "finden") return { de: `Wo ${be} ${articleFor(noun, "nom")} ${noun.de}?`, ru: `${noun.de} — ${noun.ru}` };
  if (verb.id === "reparieren") return { de: `${nom} ${be} kaputt.`, ru: `${noun.de} — ${noun.ru}` };
  return { de: `${nom} ${be} hier.`, ru: `${noun.de} — ${noun.ru}` };
}

// ─── Candidates ──────────────────────────────────────────────────────────────

/** Pairs that would need a reflexive or read oddly: «я вижу нас», «вы видите Вас». */
function natural(subject: PronounId, object: PronounId): boolean {
  if (subject === object && PRONOUNS[subject].person !== 3) return false;
  if (subject === "Sie" && object === "Sie") return false;
  const first = ["ich", "wir"];
  const second = ["du", "ihr", "Sie"];
  if (first.includes(subject) && first.includes(object)) return false;
  if (second.includes(subject) && second.includes(object)) return false;
  return true;
}

export function candidateSpecs(settings: Pick<SessionSettings, "verbs" | "constructions">): TaskSpec[] {
  const on = new Set(settings.constructions);
  const specs: TaskSpec[] = [];
  for (const verb of VERBS.filter((v) => settings.verbs.includes(v.id))) {
    const kinds: ("people" | "noun")[] = [];
    if (verb.objects.includes("person")) kinds.push("people");
    if (verb.objects.includes("thing")) kinds.push("noun");
    for (const kind of kinds) {
      for (const sentenceType of ["statement", "question", "negation"] as const) {
        for (const modal of [false, true]) {
          if (modal && !verb.modal) continue;
          if (!modal && !verb.sentenceTypes.includes(sentenceType)) continue;
          if (!constructionsNeeded(verb, kind, sentenceType, modal).every((c) => on.has(c))) continue;
          for (const subject of PEOPLE_PRONOUNS) {
            if (kind === "people") {
              for (const object of PEOPLE_PRONOUNS) {
                if (natural(subject, object)) specs.push({ kind, verb: verb.id, sentenceType, modal, subject, object, noun: null });
              }
            } else {
              for (const noun of NOUNS.filter((n) => n.verbs.includes(verb.id))) {
                specs.push({ kind, verb: verb.id, sentenceType, modal, subject, object: pronounForNoun(noun), noun: noun.id });
              }
            }
          }
        }
      }
    }
  }
  return specs;
}

export function difficultyOf(spec: TaskSpec, role: Role): string {
  if (spec.noun) return `noun:${NOUN_BY_ID[spec.noun].gender}`;
  return `${role}:${role === "subject" ? spec.subject : spec.object}`;
}

function focusRole(focus: Focus[], random: () => number): Role {
  const object = focus.includes("object_pronouns");
  const subject = focus.includes("subject_pronouns");
  if (object && !subject) return "object";
  if (subject && !object) return "subject";
  return random() < 0.7 ? "object" : "subject";
}

function weight(spec: TaskSpec, settings: SessionSettings): number {
  const targets = settings.target_pronouns;
  if (targets.length === 0) return 1;
  let w = 1;
  const subjectHit = targets.includes(spec.subject);
  const objectHit = !spec.noun && targets.includes(spec.object);
  if (settings.focus.includes("object_pronouns") && objectHit) w *= 4;
  if (settings.focus.includes("subject_pronouns") && subjectHit) w *= 4;
  // Role distinction: both participants from the confusable set — «они видят нас».
  if (settings.focus.includes("role_distinction") && subjectHit && objectHit) w *= 3;
  return w;
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

/** Distractors that test exactly the distinction in question. */
function choiceOptions(spec: TaskSpec, role: Role, random: () => number): string[] {
  const correct = role === "object" ? PRONOUNS[spec.object].acc : PRONOUNS[spec.subject].nom;
  const pool = role === "object"
    ? ["uns", "euch", "sie", "Sie", "mich", "dich", "ihn", "es", PRONOUNS[spec.object].nom === "sie" ? "ihr" : PRONOUNS[spec.object].nom]
    : ["wir", "ihr", "sie", "Sie", "er", "ich", "du", PRONOUNS[spec.subject].acc];
  const atStart = role === "subject" && spec.sentenceType !== "question";
  const shown = (s: string) => (atStart ? cap(s) : s);
  const options = [shown(correct)];
  const rest = [...new Set(pool.map(shown))].filter((o) => o !== shown(correct) && !(spec.kind === "people" && o === "es"));
  while (options.length < 4 && rest.length) {
    const i = Math.floor(random() * rest.length);
    options.push(rest.splice(i, 1)[0]);
  }
  return options.sort(() => random() - 0.5);
}

/**
 * The tap keyboard: one column per person, always in the same place — the
 * Russian word on top, the subject form under it, the object form under that
 * (я · ich · mich). «она» and «они» get a column each although both are
 * «sie» in German. Tapping fills the next empty pronoun blank, so «wir» for
 * an object stays possible — exactly the error being trained.
 */
export const TAP_COLUMNS: { ru: string; nom: string; acc: string }[] = [
  { ru: "я", nom: "ich", acc: "mich" },
  { ru: "ты", nom: "du", acc: "dich" },
  { ru: "он", nom: "er", acc: "ihn" },
  { ru: "она", nom: "sie", acc: "sie" },
  { ru: "оно", nom: "es", acc: "es" },
  { ru: "мы", nom: "wir", acc: "uns" },
  { ru: "вы", nom: "ihr", acc: "euch" },
  { ru: "они", nom: "sie", acc: "sie" },
  { ru: "Вы", nom: "Sie", acc: "Sie" },
];

function tapBank(): string[] {
  return [...TAP_COLUMNS.map((c) => c.nom), ...TAP_COLUMNS.map((c) => c.acc), "nicht"];
}

/** The sentence's own words plus three that test the distinctions: a wrong verb person, the object's subject form, a confusable pronoun. */
function buildBank(spec: TaskSpec, tokens: { slot: Slot; text: string }[], random: () => number): string[] {
  const words = tokens.map((t) => t.text);
  const verb = VERB_BY_ID[spec.verb];
  const table = spec.modal ? MODAL.present : verb.present;
  const subjRow = PRONOUNS[spec.subject].de;
  const wrongVerb = table[subjRow === "3p" || subjRow === "1p" ? "3s" : "3p"];
  const obj = PRONOUNS[spec.object];
  const objNom = obj.nom !== obj.acc ? obj.nom : obj.acc === "sie" ? "Sie" : "sie";
  const confusable = ["uns", "euch", "sie", "ihn"].filter((w) => w !== obj.acc && !words.includes(w));
  const extra = [wrongVerb, objNom, confusable[Math.floor(random() * confusable.length)]]
    .filter((w) => w && !words.includes(w));
  const bank = [...words, ...new Set(extra)];
  for (let i = bank.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [bank[i], bank[j]] = [bank[j], bank[i]];
  }
  return bank;
}

export function makeTask(spec: TaskSpec, mode: ResponseMode, opts: {
  id: string; focusRole: Role; random: () => number; bothBlanks?: boolean;
  delayedReview?: boolean; followupOf?: string | null; recheckOf?: string | null;
}): PronounTask {
  const verb = VERB_BY_ID[spec.verb];
  const german = buildGerman(spec);
  const russian = buildRussian(spec);
  const noun = spec.noun ? NOUN_BY_ID[spec.noun] : null;
  const context = noun ? nounContext(noun, verb) : null;
  const role: Role = noun ? "object" : opts.focusRole;
  const blanks: Role[] = mode === "tap" ? ["subject", "object"]
    : mode === "gaps" && opts.bothBlanks && !noun ? ["subject", "object"] : mode === "gaps" || mode === "choice" ? [role] : [];
  return {
    ...spec,
    id: opts.id,
    template_version: TEMPLATE_VERSION,
    mode,
    constructions: constructionsNeeded(verb, spec.kind, spec.sentenceType, spec.modal),
    prompt_ru: russian.text,
    notes_ru: russian.notes,
    context_de: context?.de ?? null,
    context_ru: context?.ru ?? null,
    expected: german.text,
    tokens: german.tokens,
    blanks,
    options: mode === "choice" ? choiceOptions(spec, role, opts.random) : null,
    bank: mode === "tap" ? tapBank() : mode === "build" ? buildBank(spec, german.tokens, opts.random) : null,
    focus_role: role,
    difficulty: difficultyOf(spec, role),
    delayed_review: opts.delayedReview ?? false,
    followup_of: opts.followupOf ?? null,
    recheck_of: opts.recheckOf ?? null,
    government_note: verb.governmentNote ?? null,
  };
}

/** The modes a session's main items rotate through: choice is kept for addressing a difficulty. */
export function mainModes(settings: SessionSettings, enabled: ResponseMode[]): ResponseMode[] {
  if (settings.response_mode !== "mixed") return [settings.response_mode];
  const own = enabled.filter((m) => m !== "choice" && m !== "tap" && m !== "build");
  return own.length ? own : enabled.length ? enabled : ["written"];
}

export type SessionPlanInput = {
  settings: SessionSettings;
  enabledModes: ResponseMode[];
  seed: number;
  newId: () => string;
  /** Difficulties from earlier sessions that are due for a delayed check. */
  dueDifficulties?: string[];
  /** Whether speech recognition works here; without it spoken tasks become written. */
  speechAvailable?: boolean;
};

function matchesDifficulty(spec: TaskSpec, difficulty: string): Role | null {
  const [kind, value] = difficulty.split(":");
  if (kind === "noun") return spec.noun && NOUN_BY_ID[spec.noun].gender === value ? "object" : null;
  if (kind === "object" && !spec.noun && spec.object === value) return "object";
  if (kind === "subject" && spec.subject === value) return "subject";
  return null;
}

/** A whole session, delayed checks from earlier sessions mixed in. */
export function planSession(input: SessionPlanInput): PronounTask[] {
  const random = rng(input.seed);
  const { settings } = input;
  const candidates = candidateSpecs(settings);
  if (candidates.length === 0) return [];
  let modes = mainModes(settings, input.enabledModes);
  if (input.speechAvailable === false) modes = [...new Set(modes.map((m) => (m === "spoken" ? "written" : m)))] as ResponseMode[];
  const tasks: PronounTask[] = [];
  const used = new Set<string>();
  const keyOf = (s: TaskSpec) => `${s.verb}|${s.sentenceType}|${s.modal}|${s.subject}|${s.object}|${s.noun}`;
  let gapsSeen = 0;

  const due = settings.include_delayed_review ? (input.dueDifficulties ?? []).slice(0, 3) : [];
  const delayedAt = new Set(due.map((_, i) => 1 + i * 3));

  for (let i = 0; tasks.length < settings.item_count && i < settings.item_count * 6; i++) {
    const mode = modes[tasks.length % modes.length];
    const prev = tasks[tasks.length - 1];
    const delayed = delayedAt.has(tasks.length) ? due[[...delayedAt].indexOf(tasks.length)] : null;
    let pool = candidates.filter((s) => !used.has(keyOf(s)) && (!prev || s.verb !== prev.verb || candidates.every((c) => c.verb === s.verb)));
    if (delayed) {
      const forDue = pool.filter((s) => matchesDifficulty(s, delayed));
      if (forDue.length) pool = forDue;
    }
    if (pool.length === 0) pool = candidates;
    const spec = pick(pool, pool.map((s) => weight(s, settings)), random);
    used.add(keyOf(spec));
    const role = (delayed && matchesDifficulty(spec, delayed)) || focusRole(settings.focus, random);
    if (mode === "gaps") gapsSeen++;
    tasks.push(makeTask(spec, mode, {
      id: input.newId(), focusRole: role, random,
      bothBlanks: mode === "gaps" && gapsSeen > Math.ceil(settings.item_count / (2 * modes.length)),
      delayedReview: Boolean(delayed && matchesDifficulty(spec, delayed)),
    }));
  }
  return tasks;
}

/**
 * After an error: a new task on the same difficulty right away (with choices,
 * to look at the distinction itself), and a re-check a few tasks later in the
 * session's own mode, on another verb where there is one.
 */
export function followUps(task: PronounTask, settings: SessionSettings, enabledModes: ResponseMode[], seed: number, newId: () => string): { now: PronounTask | null; later: PronounTask | null } {
  const random = rng(seed);
  const candidates = candidateSpecs(settings).filter((s) => matchesDifficulty(s, task.difficulty));
  const others = candidates.filter((s) => s.verb !== task.verb);
  const pool = others.length ? others : candidates.filter((s) => s.subject !== task.subject || s.sentenceType !== task.sentenceType);
  if (pool.length === 0) return { now: null, later: null };
  const nowSpec = pool[Math.floor(random() * pool.length)];
  const laterPool = pool.filter((s) => s !== nowSpec);
  const laterSpec = laterPool.length ? laterPool[Math.floor(random() * laterPool.length)] : nowSpec;
  const role = task.focus_role;
  const nowMode: ResponseMode = enabledModes.includes("choice") || settings.response_mode === "choice" ? "choice" : task.mode;
  return {
    now: makeTask(nowSpec, nowMode, { id: newId(), focusRole: role, random, followupOf: task.id }),
    later: makeTask(laterSpec, task.mode, { id: newId(), focusRole: role, random, recheckOf: task.id }),
  };
}

export function verbLabel(id: string): string {
  const v = VERB_BY_ID[id];
  return v ? (v.preposition ? `${v.infinitive} ${v.preposition}` : v.infinitive) : id;
}
