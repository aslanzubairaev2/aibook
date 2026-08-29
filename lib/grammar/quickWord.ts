// Сбор быстрой карточки слова из трёх источников, от самого дешёвого к самому
// дорогому: то, что уже сохранено → то, что считается правилами → то, за чем
// приходится идти в сеть.
//
// Порядок здесь и есть вся оптимизация. Всплывающая подсказка рисуется по
// первым двум слоям синхронно, в том же кадре, что и жест; третий слой
// приезжает позже и молча дополняет её.

import { conjugateGerman, needsAiBackfill, type GermanVerbForms } from "@/lib/grammar/germanVerbs";
import { predictGender, GENDER_ARTICLE } from "@/lib/nounForms";
import { getLocalAiAnalysis } from "@/lib/db/local";
import { makeAiCacheKey } from "@/lib/ai/cacheKeys";
import { freshFetch } from "@/lib/net/freshFetch";
import type { QuickWordAnswer } from "@/lib/ai/buildQuickWordPrompt";

export type QuickPos = "verb" | "noun" | "adjective" | "adverb" | "other" | "";

export type QuickNoun = {
  article: string;
  plural: string;
  /** Артикль угадан по суффиксу, а не взят из словаря — показывается иначе. */
  predicted: boolean;
};

export type QuickWord = {
  word: string;
  lemma: string;
  translation: string;
  pos: QuickPos;
  verb: GermanVerbForms | null;
  noun: QuickNoun | null;
  /** Идёт ли ещё уточнение по сети. */
  pending: boolean;
};

/** Что вызывающий экран уже знает о слове — словарная статья, если она есть. */
export type QuickWordHints = {
  lemma?: string;
  translation?: string;
  partOfSpeech?: string;
  article?: string;
  plural?: string;
  forms?: Record<string, string>;
  /** Предложение, из которого слово взято, — снимает омонимию. */
  context?: string;
};

const CACHE_KEY = "aibook:quick-word-cache";
const CACHE_LIMIT = 400;

type CacheShape = Record<string, QuickWordAnswer>;

function cacheKey(word: string, target: string, native: string) {
  return `${word.trim().toLowerCase()}|${target}|${native}`;
}

function readCache(): CacheShape {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as CacheShape;
  } catch {
    return {};
  }
}

function writeCache(key: string, value: QuickWordAnswer) {
  try {
    const all = readCache();
    all[key] = value;
    const keys = Object.keys(all);
    // Кэш подсказок — расходник: он должен помещаться в localStorage рядом со
    // всем остальным, а не выдавливать оттуда прогресс обучения.
    if (keys.length > CACHE_LIMIT) {
      for (const stale of keys.slice(0, keys.length - CACHE_LIMIT)) delete all[stale];
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    // Переполнение хранилища не должно ломать подсказку.
  }
}

/** Немецкое существительное узнаётся по заглавной букве — это не эвристика, а орфография. */
function looksLikeGermanNoun(word: string): boolean {
  return /^[A-ZÄÖÜ]/.test(word.trim());
}

function posFromLabel(label: string | undefined): QuickPos {
  const pos = (label ?? "").trim().toLowerCase();
  if (!pos) return "";
  if (pos.includes("глагол") || pos.startsWith("verb")) return "verb";
  if (pos.includes("существ") || pos.startsWith("noun") || pos.startsWith("subst")) return "noun";
  if (pos.includes("прилаг") || pos.startsWith("adj")) return "adjective";
  if (pos.includes("нареч") || pos.startsWith("adv")) return "adverb";
  return "other";
}

/**
 * Всё, что известно о слове без единого сетевого запроса.
 *
 * Возвращается синхронно, поэтому подсказка появляется в том же кадре, в
 * котором сработал жест — задержки нет вообще, а не «маленькая».
 */
export function localQuickWord(
  word: string,
  targetLanguage: string,
  nativeLanguage: string,
  hints: QuickWordHints = {},
): QuickWord {
  const clean = word.trim();
  const cached = readCache()[cacheKey(clean, targetLanguage, nativeLanguage)];

  // Слово, уже разобранное большой модалкой, знает свой перевод — второй раз
  // за ним в сеть ходить незачем.
  const analysis = getLocalAiAnalysis(makeAiCacheKey("word", clean, targetLanguage, nativeLanguage));
  const analysed = analysis?.word;

  const lemma = hints.lemma?.trim() || cached?.lemma || analysed?.lemma || clean;
  const translation = hints.translation?.trim() || cached?.translation || analysed?.translation || "";

  let pos: QuickPos = posFromLabel(hints.partOfSpeech) || (cached?.pos ?? "") || posFromLabel(analysed?.partOfSpeech);

  // Немецкая морфология считается локально; для остальных языков локального
  // движка нет, и всё приходит из сети.
  const isGerman = targetLanguage === "de";

  let verb: GermanVerbForms | null = null;
  if (isGerman && pos !== "noun" && pos !== "adjective" && pos !== "adverb") {
    verb = conjugateGerman(lemma);
    if (verb && !pos) pos = "verb";
  }

  // Сохранённые формы из словарной статьи и из кэша перекрывают вывод по
  // правилу: живая словарная запись — источник точнее любого правила.
  if (verb) {
    const praeteritum = hints.forms?.praeteritum?.trim() || cached?.praeteritum || "";
    const partizip2 = hints.forms?.partizip2?.trim() || cached?.partizip2 || "";
    const hilfsverb = hints.forms?.hilfsverb?.trim() || cached?.hilfsverb || "";
    verb = {
      ...verb,
      praeteritum: praeteritum || verb.praeteritum,
      partizip2: partizip2 || verb.partizip2,
      hilfsverb: hilfsverb === "sein" || hilfsverb === "haben" ? hilfsverb : verb.hilfsverb,
      source: praeteritum && partizip2 ? "table" : verb.source,
      // Формы из учебника или из уже полученного ответа — проверенные, и
      // сомнение правила к ним больше не относится.
      provisional: praeteritum && partizip2 ? false : verb.provisional,
    };
  }

  let noun: QuickNoun | null = null;
  if (isGerman && (pos === "noun" || (!pos && !verb && looksLikeGermanNoun(clean)))) {
    if (!pos) pos = "noun";
    const bare = lemma.replace(/^(der|die|das)\s+/i, "");
    const stored = hints.article?.trim().toLowerCase() || cached?.article || "";
    const guessed = predictGender(bare);
    noun = {
      article: stored || (guessed ? GENDER_ARTICLE[guessed] : ""),
      plural: hints.plural?.trim() || cached?.plural || "",
      predicted: !stored && Boolean(guessed),
    };
  }

  const needsNetwork =
    !translation ||
    (noun !== null && (!noun.article || !noun.plural)) ||
    (verb !== null && needsAiBackfill(verb)) ||
    (!verb && !noun && !pos);

  return { word: clean, lemma, translation, pos, verb, noun, pending: needsNetwork };
}

/**
 * Уточнение по сети — один запрос на всё, чего не хватило.
 *
 * Ответ модели не затирает то, что уже известно точно: сохранённый в словаре
 * артикль остаётся артиклем из учебника, а табличная форма глагола — табличной.
 */
export async function fetchQuickWord(
  base: QuickWord,
  targetLanguage: string,
  nativeLanguage: string,
  hints: QuickWordHints,
  authHeaders: () => Promise<Record<string, string>>,
  signal?: AbortSignal,
): Promise<QuickWord> {
  const res = await freshFetch("/api/ai/quick-word", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({
      word: base.word,
      context: hints.context,
      targetLanguage,
      nativeLanguage,
      known: { pos: base.pos, article: base.noun?.article, plural: base.noun?.plural },
    }),
    signal,
  });

  const data = (await res.json()) as { word?: QuickWordAnswer; error?: string };
  if (!res.ok || !data.word) throw new Error(data.error ?? "Не удалось получить подсказку.");
  const answer = data.word;
  writeCache(cacheKey(base.word, targetLanguage, nativeLanguage), answer);

  return mergeQuickWord(base, answer, hints);
}

/** Слияние локального ответа с сетевым — вынесено, чтобы это можно было проверить тестом. */
export function mergeQuickWord(base: QuickWord, answer: QuickWordAnswer, hints: QuickWordHints = {}): QuickWord {
  const pos: QuickPos = base.pos || answer.pos;

  let verb = base.verb;
  if (pos === "verb") {
    const fromTable = base.verb?.source === "table";
    const local = base.verb ?? conjugateGerman(answer.lemma || base.lemma);
    if (local) {
      // Модель ответила формами — правило, которому мы не доверяли, заменено
      // проверяемым ответом, и флаг `provisional` можно снять. Если модель
      // ничего не дала, флаг остаётся, и UI честно скажет, что форм нет.
      const answered = Boolean(answer.praeteritum && answer.partizip2);
      verb = {
        ...local,
        // Таблица и словарная статья точнее модели; правило — нет.
        praeteritum: fromTable ? local.praeteritum : answer.praeteritum || local.praeteritum,
        partizip2: fromTable ? local.partizip2 : answer.partizip2 || local.partizip2,
        hilfsverb:
          fromTable || (answer.hilfsverb !== "haben" && answer.hilfsverb !== "sein")
            ? local.hilfsverb
            : answer.hilfsverb,
        source: fromTable || answered ? "table" : local.source,
        provisional: fromTable ? false : local.provisional && !answered,
      };
    }
  } else {
    verb = null;
  }

  let noun = base.noun;
  if (pos === "noun") {
    const stored = hints.article?.trim().toLowerCase() ?? "";
    const article = stored || answer.article || base.noun?.article || "";
    noun = {
      article,
      plural: hints.plural?.trim() || answer.plural || base.noun?.plural || "",
      predicted: !stored && !answer.article && Boolean(base.noun?.predicted),
    };
  } else {
    noun = null;
  }

  return {
    word: base.word,
    lemma: base.lemma !== base.word ? base.lemma : answer.lemma || base.lemma,
    translation: base.translation || answer.translation,
    pos,
    verb,
    noun,
    pending: false,
  };
}
