import type { CardVariantState, Flashcard, TrainVariant } from "@/lib/types";

export const ALL_TRAIN_VARIANTS: TrainVariant[] = ["forward", "reverse", "audio"];

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

/** Keeps a dictionary batch distinct even when another batch has the same title. */
export function filterCardsByTrainingSource(
  cards: Flashcard[],
  sourceTitle: string,
  sourceId: string | null,
): Flashcard[] {
  if (sourceId) return cards.filter((card) => card.sourceBookId === sourceId);
  if (sourceTitle === "all") return cards;
  return cards.filter((card) => (card.sourceBookTitle || card.source || "") === sourceTitle);
}

/** Counts each prompt direction as an independent learned item. */
export function getCardsVariantProgress(
  cards: Flashcard[],
  variantProgress: Record<string, CardVariantState>,
): { learned: number; total: number } {
  let learned = 0;
  for (const card of cards) {
    if (card.repetitions > 0) learned += 1;
    const state = variantProgress[card.id];
    if ((state?.reverse?.repetitions ?? 0) > 0) learned += 1;
    if ((state?.audio?.repetitions ?? 0) > 0) learned += 1;
  }
  return { learned, total: cards.length * ALL_TRAIN_VARIANTS.length };
}
