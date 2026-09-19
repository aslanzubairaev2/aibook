// The four drills the «Артикли и Существительные» trainer can run, and the
// fixed order they play in for one noun when more than one is switched on:
// recognise it, name its article, name its plural, then produce the whole
// thing from the translation — recall first, production last, the same shape
// the verb trainer already uses.

export type NounQuizMode = "translation" | "article" | "plural" | "word";

/** What the learner is given before choosing an article. */
export type NounQuizPresentation = "target" | "native" | "audio";

export const NOUN_QUIZ_MODE_ORDER: NounQuizMode[] = ["translation", "article", "plural", "word"];

export const NOUN_QUIZ_MODE_LABEL: Record<NounQuizMode, string> = {
  translation: "Перевод",
  article: "Артикль",
  plural: "Мн. число",
  word: "Слово целиком",
};

export const NOUN_QUIZ_MODE_HINT: Record<NounQuizMode, string> = {
  translation: "Перевести слово на русский",
  article: "der / die / das — выбор из вариантов",
  plural: "Написать форму множественного числа",
  word: "По переводу написать слово с артиклем",
};

export const NOUN_QUIZ_PRESENTATION_ORDER: NounQuizPresentation[] = ["target", "native", "audio"];

export const NOUN_QUIZ_PRESENTATION_LABEL: Record<NounQuizPresentation, string> = {
  target: "Изучаемый язык",
  native: "Родной язык",
  audio: "Аудио",
};

export const NOUN_QUIZ_PRESENTATION_HINT: Record<NounQuizPresentation, string> = {
  target: "Показать существительное без артикля на изучаемом языке",
  native: "Показать перевод и вспомнить артикль по смыслу",
  audio: "Услышать существительное без артикля и вспомнить его род",
};

export const DEFAULT_NOUN_QUIZ_PRESENTATIONS: NounQuizPresentation[] = ["target"];

/**
 * Default session: just the article. It is the drill the learner asked for,
 * it needs nothing but the gender every noun already has, and it is the one
 * that runs without a single AI call.
 */
export const DEFAULT_NOUN_QUIZ_MODES: NounQuizMode[] = ["article"];
