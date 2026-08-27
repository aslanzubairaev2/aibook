// The learner's own answers to a homework exercise set, kept separate from the
// exercise data itself (lib/ai/buildHomeworkPrompt.ts) — the exercises are
// what the page said, the answers are what the learner typed, and only the
// second one changes while working through the lesson.

import type { HomeworkExercise } from "@/lib/ai/buildHomeworkPrompt";

/** cloze: one string per "{{n}}" blank, in order. compose/open: the whole answer. */
export type ItemAnswer = string | string[];

export type HomeworkAnswers = {
  items: Record<string, ItemAnswer>;
  conjugations: Record<string, string[]>;
};

export const EMPTY_ANSWERS: HomeworkAnswers = { items: {}, conjugations: {} };

export function itemKey(exerciseNumber: number, itemNumber: number): string {
  return `${exerciseNumber}:${itemNumber}`;
}

export function verbKey(exerciseNumber: number, verb: string): string {
  return `${exerciseNumber}:${verb}`;
}

/** No page ever leaves this unlabelled, but a cropped photo occasionally does. */
export const FALLBACK_PRONOUNS = ["1", "2", "3", "4", "5", "6"];

function isFilled(v: string | undefined): boolean {
  return (v ?? "").trim().length > 0;
}

/** Share of fields with something written in them — the only sense of "progress" that makes sense when there is nothing to grade. */
export function computeHomeworkProgress(exercises: HomeworkExercise[], answers: HomeworkAnswers): number {
  let total = 0;
  let filled = 0;

  for (const exercise of exercises) {
    if (exercise.widget === "conjugation") {
      const pronouns = exercise.pronouns?.length ? exercise.pronouns : FALLBACK_PRONOUNS;
      for (const verb of exercise.verbs ?? []) {
        total += pronouns.length;
        const forms = answers.conjugations[verbKey(exercise.number, verb)] ?? [];
        filled += forms.filter(isFilled).length;
      }
      continue;
    }
    if (exercise.widget !== "cloze" && exercise.widget !== "compose" && exercise.widget !== "open") continue;

    for (const item of exercise.items ?? []) {
      const key = itemKey(exercise.number, item.number);
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
