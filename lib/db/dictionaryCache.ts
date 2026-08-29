// Кэш словаря на время сессии.
//
// Словарь — это список, который не меняется от того, что вы переключились на
// «Практику» и вернулись обратно. Раньше каждый такой переход перемонтировал
// экран, запускал `/api/dictionary` заново и рисовал «Загружаю словарь…» на
// пустом месте, хотя ответ был получен десять секунд назад.
//
// Кэш живёт в модуле, а не в состоянии React, именно поэтому: состояние
// умирает вместе с экраном, а модуль — нет. Записанное сюда переживает
// переключение вкладок и не переживает перезагрузку страницы, что и требуется:
// свежесть данных нужна раз в запуск, а не раз в переход.

import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";

export type DictionarySnapshot = {
  entries: DictionaryEntry[];
  batches: DictionaryBatch[];
  loadedAt: number;
};

/** Ключ — пользователь и язык: чужой словарь показывать нельзя даже мгновение. */
function key(userId: string, language: string) {
  return `${userId}|${language}`;
}

const cache = new Map<string, DictionarySnapshot>();

/**
 * Насколько долго снимок считается свежим настолько, что перепроверять его не
 * нужно вовсе.
 *
 * Внутри этого окна возврат на экран словаря вообще не ходит в сеть. За его
 * пределами показывается тот же снимок, но фоном уходит запрос — экран при
 * этом не мигает.
 */
const FRESH_MS = 60_000;

export function readDictionaryCache(userId: string, language: string): DictionarySnapshot | null {
  return cache.get(key(userId, language)) ?? null;
}

export function isDictionaryFresh(snapshot: DictionarySnapshot | null): boolean {
  return snapshot !== null && Date.now() - snapshot.loadedAt < FRESH_MS;
}

export function writeDictionaryCache(
  userId: string,
  language: string,
  data: { entries: DictionaryEntry[]; batches: DictionaryBatch[] },
) {
  cache.set(key(userId, language), { ...data, loadedAt: Date.now() });
}

/** После фотографии или удаления снимок устарел — следующий вход перечитает. */
export function invalidateDictionaryCache(userId?: string, language?: string) {
  if (userId && language) cache.delete(key(userId, language));
  else cache.clear();
}
