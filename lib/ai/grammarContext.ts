// Grammar context tracking for AI discussions.
//
// After each "Обсудить с AI" response, the model returns a handful of grammar
// pattern IDs it touched on (e.g. "v2-inversion", "perfekt-past-tense").
// We accumulate these in localStorage, keyed by target language, so the next
// discussion can say "the learner has already seen: ..." and the tutor can
// reference earlier explanations instead of starting from zero every time.
//
// The list is language-agnostic — the model generates both `patternId` and
// `patternLabel`, so it works for German, French, or any other language
// without a hard-coded pattern catalogue.

import type { GrammarEncounter, GrammarPattern } from "@/lib/types";

const STORAGE_KEY = "aibook_grammar_encounters";
const MAX_PATTERNS = 40;
const PROMPT_LIMIT = 15;

function storageKey(targetLanguage: string): string {
  return `${STORAGE_KEY}:${targetLanguage}`;
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
export function saveGrammarPatterns(
  targetLanguage: string,
  patterns: GrammarPattern[],
): void {
  if (!patterns.length) return;
  try {
    const existing = loadGrammarContext(targetLanguage);
    const byId = new Map(existing.map((e) => [e.patternId, e]));

    for (const p of patterns) {
      const id = p.patternId.trim().toLowerCase();
      if (!id) continue;

      const prev = byId.get(id);
      if (prev) {
        prev.count += 1;
        // Update the label in case the model phrased it better this time.
        prev.patternLabel = p.patternLabel || prev.patternLabel;
      } else {
        byId.set(id, {
          patternId: id,
          patternLabel: p.patternLabel,
          firstSeenAt: new Date().toISOString(),
          count: 1,
        });
      }
    }

    // Keep the most recently touched patterns, capped.
    const all = [...byId.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, MAX_PATTERNS);

    localStorage.setItem(storageKey(targetLanguage), JSON.stringify(all));
  } catch {
    // localStorage full or unavailable — silently skip.
  }
}

/**
 * Format grammar context for injection into the prompt.
 * Returns a short paragraph listing previously encountered patterns,
 * or an empty string if there is nothing to report.
 */
export function formatGrammarContextForPrompt(
  encounters: GrammarEncounter[],
): string {
  if (encounters.length === 0) return "";

  // Take the top N most-seen patterns.
  const top = encounters
    .sort((a, b) => b.count - a.count)
    .slice(0, PROMPT_LIMIT);

  const items = top
    .map((e) => `"${e.patternLabel}"${e.count >= 3 ? " (seen several times)" : ""}`)
    .join(", ");

  return (
    `Grammar patterns this learner has already encountered in previous explanations: ${items}.\n` +
    `When one of these patterns appears again, you can reference the earlier explanation briefly ("you've seen this before: …") instead of explaining from scratch. But always show an example — never just name the pattern.`
  );
}
