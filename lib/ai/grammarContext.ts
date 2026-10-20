// Grammar context tracking for AI discussions.
//
// After each "Обсудить с AI" response, the model returns the grammar pattern
// IDs the answer was built around (e.g. "perfekt-past", "dativ-after-mit").
// We accumulate these in localStorage, keyed by target language, so the next
// discussion knows which explanations the learner has already had.
//
// What this list is for changed after it backfired: it used to be read as
// "remind the learner of these", and since nearly every German sentence has a
// verb in second position, that pattern was reported on almost every answer,
// climbed to the top of the list, and the tutor opened every chat with "вы уже
// встречали это правило". Now a pattern that has been explained more than once
// is treated as KNOWN — the tutor is told to stay silent about it — and the
// list is ordered by recency, so a single overexposed pattern cannot crowd
// everything else out.
//
// The list is language-agnostic — the model generates both `patternId` and
// `patternLabel`, so it works for German, French, or any other language
// without a hard-coded pattern catalogue.

import type { GrammarEncounter, GrammarPattern } from "@/lib/types";

const STORAGE_KEY = "aibook_grammar_encounters";
const MAX_PATTERNS = 40;

function storageKey(targetLanguage: string): string {
  return `${STORAGE_KEY}:${targetLanguage}`;
}

function touchedAt(encounter: GrammarEncounter): number {
  return Date.parse(encounter.lastSeenAt ?? encounter.firstSeenAt) || 0;
}

/** Load all encountered grammar patterns for a language. */
export function loadGrammarContext(targetLanguage: string): GrammarEncounter[] {
  try {
    const raw = localStorage.getItem(storageKey(targetLanguage));
    if (!raw) return [];
    return JSON.parse(raw) as GrammarEncounter[];
  } catch {
    return [];
  }
}

/**
 * Merge new patterns from an AI response into the existing context.
 * Bumps `count` for patterns already seen; appends new ones.
 */
export function mergeGrammarPatterns(
  existing: GrammarEncounter[],
  patterns: GrammarPattern[],
  now: string = new Date().toISOString(),
): GrammarEncounter[] {
  const byId = new Map(existing.map((e) => [e.patternId, { ...e }]));

  for (const p of patterns) {
    const id = p.patternId.trim().toLowerCase();
    if (!id) continue;

    const prev = byId.get(id);
    if (prev) {
      prev.count += 1;
      prev.lastSeenAt = now;
      // Update the label in case the model phrased it better this time.
      prev.patternLabel = p.patternLabel || prev.patternLabel;
    } else {
      byId.set(id, {
        patternId: id,
        patternLabel: p.patternLabel,
        firstSeenAt: now,
        lastSeenAt: now,
        count: 1,
      });
    }
  }

  // Keep the most recently touched patterns, capped.
  return [...byId.values()]
    .sort((a, b) => touchedAt(b) - touchedAt(a))
    .slice(0, MAX_PATTERNS);
}

export function saveGrammarPatterns(
  targetLanguage: string,
  patterns: GrammarPattern[],
): void {
  if (!patterns.length) return;
  try {
    const merged = mergeGrammarPatterns(loadGrammarContext(targetLanguage), patterns);
    localStorage.setItem(storageKey(targetLanguage), JSON.stringify(merged));
  } catch {
    // localStorage full or unavailable — silently skip.
  }
}
