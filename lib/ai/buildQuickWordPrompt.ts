// Один запрос, закрывающий всё, чего не знает локальная морфология.
//
// Быстрое превью слова (долгое нажатие / правая кнопка) показывает формы
// мгновенно из `lib/grammar/germanVerbs.ts` и из уже сохранённой словарной
// статьи. В сеть остаётся ровно одна дырка — перевод, а заодно и те поля,
// которые правилами не выводятся: род и множественное число существительного.
//
// Поэтому здесь один компактный запрос вместо трёх (`/translate`,
// `/noun-forms`, `/verb-forms`): три round-trip'а — это три задержки, а
// подсказка должна успевать за пальцем.

export type QuickWordPromptParams = {
  word: string;
  /** Предложение, из которого слово взято, если оно известно — снимает омонимию. */
  context?: string;
  targetLanguage: string;
  nativeLanguage: string;
  /** Что уже известно локально: эти поля модель не пересчитывает. */
  known?: { pos?: string; article?: string; plural?: string };
};

export type QuickWordAnswer = {
  lemma: string;
  translation: string;
  pos: "verb" | "noun" | "adjective" | "adverb" | "other";
  article: string;
  plural: string;
  praeteritum: string;
  partizip2: string;
  hilfsverb: string;
};

export function buildQuickWordPrompt(p: QuickWordPromptParams): string {
  const context = p.context?.trim();

  return `You are a fast ${p.targetLanguage} dictionary engine. Answer about ONE word.

Word: "${p.word}"
${context && context !== p.word ? `It appears in: "${context}" — use this only to pick the right sense.` : ""}
Answer in ${p.nativeLanguage} where a translation is asked for; every ${p.targetLanguage} form stays in ${p.targetLanguage}.

Fields:
- "lemma": the dictionary form (verb → infinitive, noun → nominative singular, adjective → positive).
- "translation": the meaning in ${p.nativeLanguage}. At most three words. No explanation, no article, no brackets.
- "pos": exactly one of "verb", "noun", "adjective", "adverb", "other".
- "article": for a noun, the definite article of the nominative singular ("der" / "die" / "das" in German). Empty string for anything that is not a noun.
- "plural": for a noun, the plural WITH its article ("die Bälle"). Empty if the noun has no plural or the word is not a noun.
- "praeteritum": for a verb, the simple past, 3rd person singular ("ging"). Empty for non-verbs.
- "partizip2": for a verb, the past participle ("gegangen"). Empty for non-verbs.
- "hilfsverb": for a verb, "haben" or "sein". Empty for non-verbs.

Rules:
- Never invent a word. If "${p.word}" is not a real ${p.targetLanguage} word, return every field as an empty string.
- Keep it short: this answer is shown in a small popup, not on a page.

Return ONLY valid JSON, no markdown:
{"lemma":"…","translation":"…","pos":"…","article":"…","plural":"…","praeteritum":"…","partizip2":"…","hilfsverb":"…"}`;
}

/** Приводит ответ модели к строгой форме — на клиент не должно попасть «почти JSON». */
export function normalizeQuickWordAnswer(raw: Record<string, unknown>): QuickWordAnswer {
  const str = (key: string, max = 80) => String(raw[key] ?? "").trim().slice(0, max);
  const pos = str("pos", 12).toLowerCase();
  const POS = ["verb", "noun", "adjective", "adverb"] as const;

  return {
    lemma: str("lemma"),
    translation: str("translation", 120),
    pos: (POS as readonly string[]).includes(pos) ? (pos as QuickWordAnswer["pos"]) : "other",
    article: str("article", 8).toLowerCase(),
    plural: str("plural"),
    praeteritum: str("praeteritum"),
    partizip2: str("partizip2"),
    hilfsverb: str("hilfsverb", 10).toLowerCase(),
  };
}
