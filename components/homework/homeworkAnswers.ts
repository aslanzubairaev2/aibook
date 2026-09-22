// The learner's own answers to a homework exercise set, kept separate from the
// exercise data itself (lib/ai/buildHomeworkPrompt.ts) — the exercises are
// what the page said, the answers are what the learner typed, and only the
// second one changes while working through the lesson.

import type { HomeworkExercise } from "@/lib/ai/buildHomeworkPrompt";

/** cloze: one string per "{{n}}" blank, in order. compose/open: the whole answer. */
export type ItemAnswer = string | string[];

export type SortSelection = {
  category?: string;
  words: string[];
};

export type HomeworkAnswers = {
  items: Record<string, ItemAnswer>;
  conjugations: Record<string, string[]>;
  /** Structured answers for vocabulary sorting exercises. */
  sortSelections?: Record<string, SortSelection>;
};

export const EMPTY_ANSWERS: HomeworkAnswers = { items: {}, conjugations: {} };

export function exerciseAnswerKey(exercise: HomeworkExercise): string {
  return exercise.answerKey ?? String(exercise.number);
}

export function itemKey(exerciseNumber: number | string, itemNumber: number): string {
  return `${exerciseNumber}:${itemNumber}`;
}

export function verbKey(exerciseNumber: number | string, verb: string): string {
  return `${exerciseNumber}:${verb}`;
}

export function sortSelectionKey(exercise: HomeworkExercise, rowNumber: number): string {
  return itemKey(exerciseAnswerKey(exercise), rowNumber);
}

const GERMAN_ARTICLE_RE = /^(der|die|das)\s+(.+)$/iu;

function cleanBankWord(word: string): string {
  return word.trim()
    .replace(/\s*,\s*[^,]+$/u, "")
    .replace(/\s+\((?:Sg\.?|Pl\.?)\)$/iu, "")
    .trim();
}

/** Keep one display form per dictionary word, preferring the article-bearing form. */
export function normalizeHomeworkBank(words: string[]): string[] {
  const cleaned = words.map(cleanBankWord).filter(Boolean);
  const articleForms = new Map<string, string>();
  for (const word of cleaned) {
    const match = word.match(GERMAN_ARTICLE_RE);
    if (match) articleForms.set(match[2].trim().toLocaleLowerCase("de-DE"), word);
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const word of cleaned) {
    const match = word.match(GERMAN_ARTICLE_RE);
    const key = (match ? match[2] : word).trim().toLocaleLowerCase("de-DE");
    const display = articleForms.get(key) ?? word;
    const displayKey = display.toLocaleLowerCase("de-DE");
    if (seen.has(displayKey)) continue;
    seen.add(displayKey);
    result.push(display);
  }
  return result;
}

const COMMON_GERMAN_PRESENT_FORMS: Record<string, string[]> = {
  gefallen: ["gefalle", "gefällst", "gefällt", "gefallen"],
  helfen: ["helfe", "hilfst", "hilft", "helfen", "helft"],
  geben: ["gebe", "gibst", "gibt", "geben", "gebt"],
  nehmen: ["nehme", "nimmst", "nimmt", "nehmen", "nehmt"],
  sehen: ["sehe", "siehst", "sieht", "sehen", "seht"],
  sprechen: ["spreche", "sprichst", "spricht", "sprechen", "sprecht"],
  fahren: ["fahre", "fährst", "fährt", "fahren", "fahrt"],
  lesen: ["lese", "liest", "lesen", "lest"],
  essen: ["esse", "isst", "essen", "esst"],
  sein: ["bin", "bist", "ist", "sind", "seid"],
  haben: ["habe", "hast", "hat", "haben", "habt"],
  werden: ["werde", "wirst", "wird", "werden", "werdet"],
};

function germanPresentForms(infinitive: string): string[] {
  const infinitiveKey = infinitive.trim().toLocaleLowerCase("de-DE");
  const known = COMMON_GERMAN_PRESENT_FORMS[infinitiveKey] ?? [];
  const stem = infinitiveKey.endsWith("en") ? infinitiveKey.slice(0, -2) : infinitiveKey;
  const forms = new Set([infinitiveKey, ...known]);
  if (stem) {
    forms.add(`${stem}e`);
    forms.add(`${stem}st`);
    forms.add(`${stem}t`);
    forms.add(`${stem}en`);
    // Verbs whose stem ends in -d/-t/-m/-n take an extra e before -st/-t.
    if (/[dtmn]$/u.test(stem)) {
      forms.add(`${stem}est`);
      forms.add(`${stem}et`);
    }
  }
  return [...forms];
}

/** True when a typed answer is the infinitive or a normal German present form. */
export function isGermanVerbFormOf(answer: string, infinitive: string): boolean {
  const value = answer.trim().toLocaleLowerCase("de-DE").replace(/[.!?,;:]+$/u, "");
  return value.length > 0 && germanPresentForms(infinitive).includes(value);
}

/**
 * The 6 subject markers a conjugation field is labelled with — same fixed set
 * components/verbs/VerbsQuiz.tsx already uses for its own conjugation drill
 * (that component doesn't localize them per target language either). Used
 * unconditionally rather than trusting the photo extraction's own "pronouns"
 * guess, which is exactly the kind of thing a page never actually varies.
 */
export const CONJUGATION_PRONOUNS = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];

function formationFieldCount(exercise: HomeworkExercise, itemNumber: number): number {
  const item = exercise.items?.find((candidate) => candidate.number === itemNumber);
  return item?.fields?.length ?? exercise.fields?.length ?? 1;
}

function isFilled(v: string | undefined): boolean {
  return (v ?? "").trim().length > 0;
}

/** Share of fields with something written in them — the only sense of "progress" that makes sense when there is nothing to grade. */
export function computeHomeworkProgress(exercises: HomeworkExercise[], answers: HomeworkAnswers): number {
  let total = 0;
  let filled = 0;

  for (const exercise of exercises) {
    if (exercise.widget === "conjugation") {
      for (const verb of exercise.verbs ?? []) {
        total += CONJUGATION_PRONOUNS.length;
        const forms = answers.conjugations[verbKey(exerciseAnswerKey(exercise), verb)] ?? [];
        filled += forms.filter(isFilled).length;
      }
      continue;
    }
    if (exercise.widget === "formation") {
      for (const item of exercise.items ?? []) {
        const fieldCount = formationFieldCount(exercise, item.number);
        total += fieldCount;
        const value = answers.items[itemKey(exerciseAnswerKey(exercise), item.number)];
        const values = Array.isArray(value) ? value : value ? [value] : [];
        filled += values.slice(0, fieldCount).filter(isFilled).length;
      }
      continue;
    }
    if (exercise.widget === "sort") {
      const rowCount = exercise.sortRows?.length ?? exercise.categories?.length ?? 0;
      for (let index = 0; index < rowCount; index += 1) {
        total += 1;
        const selection = answers.sortSelections?.[sortSelectionKey(exercise, index + 1)];
        if (selection?.words.some((word) => isFilled(word))) {
          filled += 1;
          continue;
        }
        const value = answers.items[itemKey(exerciseAnswerKey(exercise), index + 1)];
        if (typeof value === "string" && isFilled(value)) filled += 1;
      }
      continue;
    }
    if (exercise.widget !== "cloze" && exercise.widget !== "compose" && exercise.widget !== "open") continue;

    for (const item of exercise.items ?? []) {
      const key = itemKey(exerciseAnswerKey(exercise), item.number);
      if (exercise.widget === "cloze") {
        const blankCount = item.blanks?.length ?? 1;
        total += blankCount;
        const value = answers.items[key];
        const values = Array.isArray(value) ? value : [];
        filled += values.filter(isFilled).length;
      } else {
        total += 1;
        const value = answers.items[key];
        if (typeof value === "string" && isFilled(value)) filled += 1;
      }
    }
  }

  return total === 0 ? 0 : Math.round((filled / total) * 100);
}
