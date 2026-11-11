// One notion of «трудное слово» across the trainers.
//
// A verb missed again and again in «Глаголы» was a hard word there and an
// ordinary one in the cards: each trainer judged a word only by its own
// answers. The card trainer's «Сложные» now also takes the cards whose word
// keeps being missed in a grammar trainer — the same word, however it was
// drilled, comes back in the place meant for the words that will not stick.

import { adaptiveDifficultyScore } from "@/lib/srs/adaptiveDifficulty";
import type { ModuleProgress } from "@/lib/srs/packProgress";
import type { Flashcard } from "@/lib/types";

type Entry = { id: string; lemma?: string | null; headword?: string | null };

const LEADING = /^(?:der|die|das|ein|eine|einen|sich|to|the|a|an)\s+/i;

/** «der Hund» / «sich erinnern» / «Hund, -e» → «hund» / «erinnern» / «hund». */
export function wordKey(text: string | null | undefined): string {
  let key = (text ?? "").trim().toLowerCase();
  // A card front may carry plural or forms after a comma or in brackets.
  key = key.split(/[,;(/]/)[0].trim();
  let previous = "";
  while (key !== previous) {
    previous = key;
    key = key.replace(LEADING, "");
  }
  return key;
}

/** The words (by key) a trainer module counts as difficult — by the word's own answers or by any one drill of it. */
export function strugglingWordKeys(sources: Array<{ entries: Entry[]; progress: ModuleProgress }>): Set<string> {
  const keys = new Set<string>();
  for (const { entries, progress } of sources) {
    const hardIds = new Set<string>();
    for (const [id, state] of Object.entries(progress.words)) {
      if (adaptiveDifficultyScore(state) > 0) hardIds.add(id);
    }
    for (const [drill, state] of Object.entries(progress.drills ?? {})) {
      if (adaptiveDifficultyScore(state) > 0) hardIds.add(drill.split("|")[0]);
    }
    if (hardIds.size === 0) continue;
    for (const entry of entries) {
      if (!hardIds.has(entry.id)) continue;
      const key = wordKey(entry.lemma || entry.headword);
      if (key) keys.add(key);
    }
  }
  return keys;
}

/** Ids of the word cards whose word is in `keys`. */
export function cardsForWordKeys(cards: Flashcard[], keys: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  if (keys.size === 0) return ids;
  for (const card of cards) {
    if (card.type !== "word") continue;
    if (keys.has(wordKey(card.front))) ids.add(card.id);
  }
  return ids;
}
