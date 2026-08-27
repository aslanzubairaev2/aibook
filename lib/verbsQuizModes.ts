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
  conjugation: "Спрягать в настоящем времени",
  phrase: "Перевести фразу на немецкий",
};

/** Default session: exactly what the trainer already did before modes existed. */
export const DEFAULT_QUIZ_MODES: QuizMode[] = ["forms"];
