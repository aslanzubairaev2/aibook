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
// default-on drill (a bare conjugated word, e.g. "singe" for "ich"); past and
// future are opt-in and ask for the whole natural phrase instead ("ich habe
// gesungen", "ich werde singen"), since that is what the AI grammar table
// actually gives for those tenses. Each selected tense becomes its own step
// (6 fields, same as present today) rather than one step with up to 18.
export type ConjugationTense = "present" | "past" | "future";

export const CONJUGATION_TENSE_ORDER: ConjugationTense[] = ["present", "past", "future"];

export const CONJUGATION_TENSE_LABEL: Record<ConjugationTense, string> = {
  present: "Настоящее",
  past: "Прошедшее",
  future: "Будущее",
};

export const DEFAULT_CONJUGATION_TENSES: ConjugationTense[] = ["present"];
