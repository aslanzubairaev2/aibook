// Цифры для главной страницы.
//
// Всё считается из того, что уже лежит в браузере: карточки приходят из
// локального зеркала при запуске, словарь — из кэшей, которые ведут экраны
// «Глаголы» и «Существительные». Поэтому главная рисуется заполненной сразу,
// без единого запроса, и остаётся правдой офлайн.
//
// Ни одно число здесь не «примерно»: если посчитать нечестно нельзя, поле
// просто не показывается — см. `articlesToLearn`.

import {
  ALL_TRAIN_VARIANTS, computeDeckStats, endOfTodayMs, getVariantProgress, isVariantDue,
  type DeckStats,
} from "@/lib/cards";
import { isNounEntry, nounGender, GENDER_ORDER, type NounGender } from "@/lib/nounForms";
import { isIrregularGermanVerb, normalizePos } from "@/lib/verbForms";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import type { CardVariantState, Flashcard } from "@/lib/types";

export type VerbStats = {
  total: number;
  irregular: number;
  /** Неправильные глаголы, у которых Präteritum / Partizip II ещё не заполнены. */
  missingForms: number;
};

export type NounStats = {
  total: number;
  /** Существительные с известным артиклем — их и можно тренировать. */
  withArticle: number;
  /** Артикль не известен: ни в словаре, ни выводимый из записи. */
  withoutArticle: number;
  byGender: Record<NounGender, number>;
  /** Род, которого в словаре меньше всего, — самый слабый по покрытию. */
  weakestGender: NounGender | null;
};

export type HomeStats = {
  deck: DeckStats;
  /** Карточка, с которой начнётся сегодняшнее повторение. */
  nextUp: Flashcard | null;
  /** Слов и фраз в колоде, и сколько из них уже держится в памяти. */
  words: { total: number; learned: number; due: number; fresh: number };
  verbs: VerbStats;
  nouns: NounStats;
  /** Есть ли вообще о чём говорить — иначе главная не показывает пустых нулей. */
  hasDictionary: boolean;
};

export function computeVerbStats(entries: DictionaryEntry[]): VerbStats {
  const verbs = entries.filter((e) => normalizePos(e.part_of_speech).includes("глагол"));
  const irregular = verbs.filter((e) => isIrregularGermanVerb(e.lemma, e.headword, e.forms ?? {}));

  return {
    total: verbs.length,
    irregular: irregular.length,
    // Именно у неправильных пробел в формах чего-то стоит: у правильных формы
    // выводятся правилом и без словаря.
    missingForms: irregular.filter((e) => !e.forms?.praeteritum || !e.forms?.partizip2).length,
  };
}

export function computeNounStats(entries: DictionaryEntry[]): NounStats {
  const nouns = entries.filter(isNounEntry);
  const byGender: Record<NounGender, number> = { m: 0, f: 0, n: 0, pl: 0 };
  let withArticle = 0;

  for (const entry of nouns) {
    const gender = nounGender(entry);
    if (gender) {
      byGender[gender] += 1;
      withArticle += 1;
    }
  }

  // «Самый слабый род» имеет смысл только когда есть что сравнивать: на трёх
  // словах это не наблюдение, а шум.
  const ranked = GENDER_ORDER.filter((g) => g !== "pl");
  const weakestGender =
    withArticle >= 12 ? ranked.reduce((min, g) => (byGender[g] < byGender[min] ? g : min), ranked[0]) : null;

  return {
    total: nouns.length,
    withArticle,
    withoutArticle: nouns.length - withArticle,
    byGender,
    weakestGender,
  };
}

/**
 * Всё, что главная показывает, за один проход.
 *
 * `entries` — объединённый словарь из локальных кэшей; дубликаты по id
 * отсеиваются, потому что кэши глаголов и существительных пересекаются.
 */
export function computeHomeStats(
  cards: Flashcard[],
  variantProgress: Record<string, CardVariantState>,
  entries: DictionaryEntry[],
  now = new Date(),
): HomeStats {
  const deck = computeDeckStats(cards, variantProgress, endOfDay(now));

  return {
    deck,
    nextUp: pickNextUp(cards, variantProgress, now),
    words: {
      total: deck.totalCards,
      learned: deck.learnedCards,
      due: deck.dueCards,
      fresh: deck.byStatus.new ?? 0,
    },
    verbs: computeVerbStats(entries),
    nouns: computeNounStats(entries),
    hasDictionary: entries.length > 0,
  };
}

/**
 * Первая карточка сегодняшней очереди.
 *
 * Главная показывает не «60 карточек», а само слово, с которого начнётся
 * повторение: это единственный экран, где приложение может показать
 * собственный материал учащегося вместо статистики о нём.
 *
 * Порядок — по сроку: самое просроченное первым, ровно как их и покажет
 * тренажёр. Поэтому слово на главной и первое слово в сессии совпадают, а не
 * выглядят как два независимых выбора.
 */
export function pickNextUp(
  cards: Flashcard[],
  variantProgress: Record<string, CardVariantState>,
  now = new Date(),
): Flashcard | null {
  const todayEnd = endOfTodayMs(now);
  let best: Flashcard | null = null;
  let bestDue = Infinity;

  for (const card of cards) {
    // Считать надо по всем направлениям, а не только по «узнаванию»: именно так
    // считает `computeDeckStats`, а значит и кнопка «Повторить N». Проверка по
    // одному направлению давала расхождение, при котором заголовок сообщал «на
    // сегодня всё», пока кнопка рядом предлагала повторить шестьдесят карточек.
    for (const variant of ALL_TRAIN_VARIANTS) {
      const progress = getVariantProgress(card, variant, variantProgress);
      if (!isVariantDue(progress, todayEnd)) continue;
      // Новая карточка ещё не назначена на день — она встаёт после
      // просроченных, но перед теми, что подошли только сегодня.
      const due = progress.status === "new" ? todayEnd : Date.parse(progress.dueAt);
      if (due < bestDue) { best = card; bestDue = due; }
    }
  }
  return best;
}

/** Словари глаголов и существительных пересекаются — объединяем по id. */
export function mergeDictionaries(...lists: DictionaryEntry[][]): DictionaryEntry[] {
  const seen = new Map<string, DictionaryEntry>();
  for (const list of lists) {
    for (const entry of list) seen.set(entry.id, entry);
  }
  return [...seen.values()];
}

function endOfDay(now: Date): Date {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end;
}
