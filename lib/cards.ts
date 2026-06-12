import type { Flashcard } from "@/lib/types";

/** Normalizes card text for duplicate comparison: trims, collapses whitespace, lowercases. */
export function normalizeCardText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Finds an existing card with the same front text (case/whitespace-insensitive). */
export function findDuplicateCard(front: string, cards: Flashcard[]): Flashcard | null {
  const norm = normalizeCardText(front);
  if (!norm) return null;
  return cards.find((c) => normalizeCardText(c.front) === norm) ?? null;
}
