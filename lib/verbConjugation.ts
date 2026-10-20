// German conjugation the trainer can build on the device, from the principal
// parts a verb entry already stores (praeteritum, partizip2, hilfsverb,
// trennbar) — so the «Спряжения» drill does not have to ask the AI for a
// 72-phrase table just to read six forms out of it.
//
// Only what is fully rule-bound is generated here:
//   Präteritum — the stored past stem plus the past endings;
//   Perfekt    — haben/sein in the present plus the stored Partizip II;
//   Futur I    — werden plus the infinitive;
//   Präsens    — weak verbs only. A strong verb's du/er stem change («fährst»,
//                «gibt», «läuft») is not derivable from the principal parts,
//                so those still come from the AI's brief table — once, then
//                from the per-lemma store in lib/db/local.ts.
//
// Anything this cannot do with confidence returns null and the caller falls
// back to the AI; a wrong «expected» answer is worse than a slow one.

import type { ConjugationTense } from "@/lib/verbsQuizModes";
import { checkTypedAnswer, normalizeAnswer, type AnswerCheck } from "@/lib/srs/activeTraining";
import type { GermanVerbClass } from "@/lib/verbForms";

/** 1sg, 2sg, 3sg, 1pl, 2pl, 3pl — the fixed person order of every table here. */
export const GERMAN_PERSONS = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"] as const;

const REFLEXIVE_ACC = ["mich", "dich", "sich", "uns", "euch", "sich"];
const HABEN = ["habe", "hast", "hat", "haben", "habt", "haben"];
const SEIN = ["bin", "bist", "ist", "sind", "seid", "sind"];
const WERDEN = ["werde", "wirst", "wird", "werden", "werdet", "werden"];

function clean(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function isMarkedSeparable(value: string | undefined): boolean {
  return /^(1|true|ja|yes|да)$/iu.test(clean(value));
}

/** The first of several stored variants: «buk/backte» → «buk». */
function firstVariant(value: string): string {
  return clean(value.split(/[/,;]|\s+oder\s+/u)[0]);
}

type VerbShape = {
  /** «sich » was in front of the lemma. */
  reflexive: boolean;
  /** «ein» for «einkaufen» — only when the entry marks the verb separable. */
  particle: string;
  /** The infinitive without «sich» and without the separable particle: «kaufen». */
  base: string;
  /** The whole infinitive without «sich»: «einkaufen». */
  infinitive: string;
};

/**
 * Splits «sich einkaufen»-style lemmas into their parts. The separable
 * particle is read from the stored Präteritum («kaufte ein»), which says
 * exactly where the verb splits — guessing from a prefix list would get
 * «übersetzen» or «umfahren» wrong.
 */
export function germanVerbShape(lemma: string, forms: Record<string, string | undefined>): VerbShape | null {
  const raw = clean(lemma).toLocaleLowerCase("de-DE");
  if (!raw) return null;
  const reflexive = /^sich\s/u.test(raw);
  const infinitive = raw.replace(/^sich\s+/u, "");
  if (!/^[a-zäöüß]+$/u.test(infinitive)) return null;

  let particle = "";
  if (isMarkedSeparable(forms.trennbar)) {
    const words = firstVariant(forms.praeteritum ?? "").toLocaleLowerCase("de-DE").split(" ");
    const last = words.length > 1 ? words.at(-1)! : "";
    if (!last || !infinitive.startsWith(last) || infinitive.length <= last.length + 2) return null;
    particle = last;
  }
  return { reflexive, particle, base: infinitive.slice(particle.length), infinitive };
}

/** «freute» + «mich» + «an» → «freute mich an»: finite verb, pronoun, particle. */
function assemble(finite: string, person: number, shape: VerbShape, tail = ""): string {
  return [finite, shape.reflexive ? REFLEXIVE_ACC[person] : "", tail, shape.particle].filter(Boolean).join(" ");
}

/** «habe» + «mich» + «gefreut» — the participle/infinitive keeps the particle itself. */
function assembleCompound(aux: string, person: number, shape: VerbShape, rest: string): string {
  return [aux, shape.reflexive ? REFLEXIVE_ACC[person] : "", rest].filter(Boolean).join(" ");
}

function endsWithDental(stem: string): boolean {
  return /[td]$/u.test(stem);
}

/**
 * Stems that need an «e» before -st/-t: arbeit-, red-, and a consonant + m/n
 * where the consonant is not l/r/m/n or a lengthening h (atm-, öffn-,
 * rechn-, zeichn- — but lern-, wohn-, film-).
 */
function needsLinkingE(stem: string): boolean {
  return endsWithDental(stem) || /[^aeiouäöülrhmn][mn]$/u.test(stem) || /ch[mn]$/u.test(stem);
}

function endsWithSibilant(stem: string): boolean {
  return /(s|ß|z|x)$/u.test(stem);
}

function weakPresent(shape: VerbShape): string[] | null {
  const base = shape.base;
  let forms: string[];
  if (/eln$/u.test(base)) {
    // sammeln: ich sammle, du sammelst … wir sammeln
    const stem = base.slice(0, -1); // «sammel»
    forms = [`${stem.slice(0, -2)}le`, `${stem}st`, `${stem}t`, base, `${stem}t`, base];
  } else if (/ern$/u.test(base)) {
    // wandern: ich wandere, du wanderst … wir wandern
    const stem = base.slice(0, -1); // «wander»
    forms = [`${stem}e`, `${stem}st`, `${stem}t`, base, `${stem}t`, base];
  } else if (/en$/u.test(base) && base.length > 3) {
    const stem = base.slice(0, -2);
    const link = needsLinkingE(stem) ? "e" : "";
    const du = endsWithSibilant(stem) ? `${stem}t` : `${stem}${link}st`;
    forms = [`${stem}e`, du, `${stem}${link}t`, base, `${stem}${link}t`, base];
  } else {
    return null;
  }
  return forms.map((finite, person) => assemble(finite, person, shape));
}

function preteritum(shape: VerbShape, stored: string): string[] | null {
  const core = firstVariant(stored).toLocaleLowerCase("de-DE").split(" ")[0];
  if (!core || !/^[a-zäöüß]+$/u.test(core)) return null;
  let forms: string[];
  if (core.endsWith("e")) {
    // machte, wusste, wurde: -, st, -, n, t, n
    forms = [core, `${core}st`, core, `${core}n`, `${core}t`, `${core}n`];
  } else {
    // fuhr, fand, las: -, st/est, -, en, t/et, en
    const du = endsWithDental(core) || endsWithSibilant(core) ? `${core}est` : `${core}st`;
    const ihr = endsWithDental(core) ? `${core}et` : `${core}t`;
    forms = [core, du, core, `${core}en`, ihr, `${core}en`];
  }
  return forms.map((finite, person) => assemble(finite, person, shape));
}

/** The auxiliaries the stored «hilfsverb» allows, in the order it names them. */
function auxiliariesOf(hilfsverb: string | undefined): string[][] | null {
  const aux = clean(hilfsverb).toLowerCase();
  const haben = aux.search(/haben|hat/);
  const sein = aux.search(/sein|ist/);
  if (haben < 0 && sein < 0) return null;
  if (haben < 0) return [SEIN];
  if (sein < 0) return [HABEN];
  return haben < sein ? [HABEN, SEIN] : [SEIN, HABEN];
}

/**
 * «haben/sein» verbs (schwimmen, fahren) are right with either auxiliary, so
 * their forms carry both as «habe geschwommen / bin geschwommen» — the quiz
 * accepts any part between « / ».
 */
function perfekt(shape: VerbShape, forms: Record<string, string | undefined>): string[] | null {
  const auxes = auxiliariesOf(forms.hilfsverb);
  const p2 = firstVariant(forms.partizip2 ?? "").toLocaleLowerCase("de-DE").replace(/^(hat|ist|haben|sein)\s+/u, "");
  if (!auxes || !p2 || !/^[a-zäöüß]+$/u.test(p2)) return null;
  return GERMAN_PERSONS.map((_, person) => auxes.map((aux) => assembleCompound(aux[person], person, shape, p2)).join(" / "));
}

function future(shape: VerbShape): string[] {
  return WERDEN.map((finite, person) => assembleCompound(finite, person, shape, shape.infinitive));
}

/**
 * The six forms of one tense, without the pronoun («fahre», «habe gesungen»),
 * or null when the device cannot be sure and the AI table must be asked.
 */
export function conjugateGermanLocally(
  lemma: string,
  forms: Record<string, string | undefined>,
  tense: ConjugationTense,
  verbClass: GermanVerbClass,
): string[] | null {
  const shape = germanVerbShape(lemma, forms);
  if (!shape) return null;
  switch (tense) {
    case "present":
      // Mixed verbs (bringen, denken, kennen) are regular in the present; a
      // strong one may change its stem, and sein/haben/modals are their own system.
      return verbClass === "weak" || verbClass === "mixed" || verbClass === "impersonal" ? weakPresent(shape) : null;
    case "preteritum":
      return forms.praeteritum ? preteritum(shape, forms.praeteritum) : null;
    case "perfekt":
      return perfekt(shape, forms);
    case "future":
      return future(shape);
  }
}

/**
 * Which persons a step actually asks. Most of a German paradigm is the same
 * six endings on every verb; typing them for a hundred verbs a day trains the
 * rule a hundred times over and the verb not at all. So each tense asks only
 * where this verb can differ from that rule, and one rotating person where it
 * cannot — over a few days every person still comes up.
 *
 * `seed` picks the rotating person; the caller passes something random per
 * session so the choice changes from day to day.
 */
export function keyPersons(tense: ConjugationTense, verbClass: GermanVerbClass, seed: number): number[] {
  const pick = (options: number[]) => [options[Math.abs(Math.floor(seed)) % options.length]];
  if (verbClass === "impersonal") return [2];
  switch (tense) {
    case "present":
      if (verbClass === "special") return [0, 1, 2, 3, 4, 5];
      // strong/mixed: the stem change lives in du and er (fährst, fährt).
      if (verbClass !== "weak") return [1, 2];
      return pick([1, 2, 4]);
    case "preteritum":
      // er is the stored Präteritum itself; du and wir show the endings on the strong stem.
      if (verbClass === "weak") return pick([1, 3, 4]);
      return [1, 3];
    case "perfekt":
    case "future":
      // Perfekt is haben/sein + Partizip II, Futur is werden + Infinitiv —
      // one person is enough to show the auxiliary is right.
      return pick([0, 1, 2, 3, 4, 5]);
  }
}

const UMLAUT_PAIRS: Array<[RegExp, string]> = [[/ae/g, "ä"], [/oe/g, "ö"], [/ue/g, "ü"]];

function stripUmlauts(text: string): string {
  return text.replace(/[äöü]/g, (ch) => ({ ä: "a", ö: "o", ü: "u" })[ch as "ä" | "ö" | "ü"]);
}

/** How forgiving a check is: the general one, umlaut-strict (forms), or exact (conjugation). */
export type CheckStrictness = "lenient" | "umlaut" | "exact";

/**
 * The general checker forgives a missing umlaut and a one-letter slip —
 * right for a translation, wrong for conjugation: «fährst» against «fahrst»,
 * «besuchst» against «besucht» ARE the things being drilled. So:
 *   "umlaut" — a form that differs only in ä/ö/ü is wrong (Präteritum/Partizip);
 *   "exact"  — on top of that, any other letter is wrong too (endings).
 * «ae/oe/ue» typed on a keyboard without umlauts, and «ss» for «ß», still count.
 */
export function checkConjugationAnswer(input: string, expected: string, strictness: Exclude<CheckStrictness, "lenient"> = "exact"): AnswerCheck {
  const given = normalizeAnswer(input);
  const want = normalizeAnswer(expected);
  if (!given) return { verdict: "wrong" };
  if (given === want) return { verdict: "correct" };
  let spelled = given;
  for (const [pattern, umlaut] of UMLAUT_PAIRS) spelled = spelled.replace(pattern, umlaut);
  const sharp = (text: string) => text.replace(/ß/g, "ss");
  if (sharp(spelled) === sharp(want) || sharp(given) === sharp(want)) return { verdict: "correct" };
  if (stripUmlauts(sharp(given)) === stripUmlauts(sharp(want))) return { verdict: "wrong", hint: "Умлаут: корень здесь меняется" };
  if (strictness === "umlaut") return checkTypedAnswer(input, expected);
  return { verdict: "wrong" };
}

const VERDICT_RANK = { correct: 2, almost: 1, wrong: 0 } as const;

/**
 * Checks against every alternative in «a / b» and keeps the best match, so
 * the correction shown under a wrong answer is the variant the learner was
 * closest to.
 */
export function checkAgainstAlternatives(input: string, expected: string, strictness: CheckStrictness): AnswerCheck & { matched: string } {
  const options = expected.split(" / ").map((part) => part.trim()).filter(Boolean);
  let best: (AnswerCheck & { matched: string }) | null = null;
  for (const option of options.length ? options : [expected]) {
    const check = strictness === "lenient" ? checkTypedAnswer(input, option) : checkConjugationAnswer(input, option, strictness);
    if (!best || VERDICT_RANK[check.verdict] > VERDICT_RANK[best.verdict]) best = { ...check, matched: option };
    if (check.verdict === "correct") break;
  }
  return best!;
}
