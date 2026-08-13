import type { CardFilters, CardVariantState, Flashcard, SkillProgress, TrainVariant } from "@/lib/types";

export const ALL_TRAIN_VARIANTS: TrainVariant[] = ["forward", "reverse", "audio"];

/** Dictionary grammar follows the native meaning on a separate line. */
export function splitCardBack(back: string): { meaning: string; details: string } {
  const [meaning = "", ...detailLines] = back.replace(/\r\n/g, "\n").split("\n");
  return { meaning: meaning.trim(), details: detailLines.join("\n").trim() };
}

function reviewedAt(progress: SkillProgress): number {
  const value = progress.lastReviewedAt ? Date.parse(progress.lastReviewedAt) : 0;
  return Number.isFinite(value) ? value : 0;
}

function newerProgress(local?: SkillProgress, remote?: SkillProgress): SkillProgress | undefined {
  if (!local) return remote;
  if (!remote) return local;
  const localTime = reviewedAt(local);
  const remoteTime = reviewedAt(remote);
  if (localTime !== remoteTime) return localTime > remoteTime ? local : remote;
  if (local.repetitions !== remote.repetitions) return local.repetitions > remote.repetitions ? local : remote;
  return remote;
}

/** Keeps offline reviews while accepting newer progress loaded from Supabase. */
export function mergeCardVariantProgress(
  local: Record<string, CardVariantState>,
  remote: Record<string, CardVariantState>,
): Record<string, CardVariantState> {
  const merged: Record<string, CardVariantState> = {};
  for (const cardId of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const reverse = newerProgress(local[cardId]?.reverse, remote[cardId]?.reverse);
    const audio = newerProgress(local[cardId]?.audio, remote[cardId]?.audio);
    if (reverse || audio) merged[cardId] = { reverse, audio };
  }
  return merged;
}

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

/** Exact filters used when opening the trainer from one dictionary batch. */
export function createBatchTrainingFilters(
  current: CardFilters | undefined,
  batchId: string,
  batchTitle: string,
): CardFilters {
  return {
    ...current,
    filterBook: batchTitle,
    filterStatus: "all",
    filterType: "all",
    filterLevel: "all",
    trainBook: batchTitle,
    trainSourceId: batchId,
    trainFilter: "all",
    trainStatus: "all",
  };
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
