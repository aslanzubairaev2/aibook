// The four drills the Глаголы trainer can run, and the fixed order they play
// in for one verb when more than one is switched on: translate it, recall its
// principal parts, conjugate it in the present, then use it in a sentence —
// easiest recall first, production last.

export type QuizMode = "translation" | "forms" | "conjugation" | "phrase";

export const QUIZ_MODE_ORDER: QuizMode[] = ["translation", "forms", "conjugation", "phrase"];

export const QUIZ_MODE_LABEL: Record<QuizMode, string> = {
  translation: "Перевод",
  forms: "Формы",
  conjugation: "Спряжения",
  phrase: "Фразы",
};

export const QUIZ_MODE_HINT: Record<QuizMode, string> = {
  translation: "Перевести слово на русский",
  forms: "Präteritum и Partizip II",
  conjugation: "Спрягать по лицам — время выбирается ниже",
  phrase: "Перевести фразу на немецкий",
};

/** Default session: exactly what the trainer already did before modes existed. */
export const DEFAULT_QUIZ_MODES: QuizMode[] = ["forms"];

// Which tense(s) the "Спряжения" drill covers. Present is the original,
// default-on drill. The past has two distinct forms in German, not one —
// Präteritum (the written/narrative form: "sang") and Perfekt (what a native
// speaker actually says out loud: "habe gesungen") — so they are two separate
// toggles, not a single "past". Every field asks only for what the pronoun
// label doesn't already say — the field's own person is never retyped, but
// Perfekt/future still require the conjugated auxiliary ("habe"/"bin"/
// "werde"), which is exactly the point of drilling them. Each selected tense
// becomes its own step (6 fields, same as present today) rather than one step
// with as many as 24.
export type ConjugationTense = "present" | "preteritum" | "perfekt" | "future";

export const CONJUGATION_TENSE_ORDER: ConjugationTense[] = ["present", "preteritum", "perfekt", "future"];

export const CONJUGATION_TENSE_LABEL: Record<ConjugationTense, string> = {
  present: "Настоящее",
  preteritum: "Прошедшее (книжное)",
  perfekt: "Прошедшее (разговорное)",
  future: "Будущее",
};

export const DEFAULT_CONJUGATION_TENSES: ConjugationTense[] = ["present"];
