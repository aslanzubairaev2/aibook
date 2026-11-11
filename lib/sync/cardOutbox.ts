"use client";

// Card writes that have not reached the account yet.
//
// A grade used to be saved locally and sent to Supabase with a bare
// `void upsert(...)`: if the request failed — a tunnel, a sleeping phone, a
// dropped token — nothing remembered that it had, and the other devices never
// saw the answer. Now every write is noted here first (localStorage, so it
// survives the page being closed mid-request) and is crossed off only when the
// server confirms it. Whatever is left goes out again at start-up, when the
// connection comes back, and whenever the app returns to view.
//
// The pending card itself is kept, not just its id: it is then also the
// record of the answer should the local deck fail to persist it.

import { getLocalNamespace } from "@/lib/db/local";
import {
  sbDeleteFlashcards, sbUpsertCardVariantProgress, sbUpsertFlashcard,
  type CardVariantProgressWrite, type DbFlashcard,
} from "@/lib/db/supabase";
import type { Flashcard, SkillProgress, TrainVariant } from "@/lib/types";

type SideVariant = Exclude<TrainVariant, "forward">;

type Outbox = {
  cards: Record<string, { card: Flashcard; tries: number }>;
  variants: Record<string, { progress: SkillProgress; tries: number }>;
  deletes: Record<string, number>;
};

/** A write the server keeps refusing (not a network failure) must not be retried forever. */
const MAX_TRIES = 25;

function storageKey(): string {
  return `aibook:card-outbox:${getLocalNamespace()}`;
}

function read(): Outbox {
  const empty: Outbox = { cards: {}, variants: {}, deletes: {} };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(storageKey());
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Outbox>;
    return { cards: parsed.cards ?? {}, variants: parsed.variants ?? {}, deletes: parsed.deletes ?? {} };
  } catch {
    return empty;
  }
}

function write(outbox: Outbox) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey(), JSON.stringify(outbox));
  } catch {
    // Storage full: this write still goes out once; only the retry is lost.
  }
}

function variantKey(cardId: string, variant: SideVariant): string {
  return `${cardId}|${variant}`;
}

export function flashcardToDb(card: Flashcard, userId: string): DbFlashcard {
  return {
    id: card.id,
    user_id: userId,
    vocabulary_item_id: null,
    front: card.front,
    back: card.back,
    source_book_title: card.sourceBookTitle || card.source || null,
    selection_type: card.type,
    repetitions: card.repetitions,
    lapses: card.lapses,
    easiness_factor: card.easeFactor,
    ...(card.stability != null ? { stability: card.stability, difficulty: card.difficulty ?? null } : {}),
    interval_days: card.intervalDays,
    next_review_at: card.dueAt,
    last_reviewed_at: card.lastReviewedAt || null,
    source_book_id: card.sourceBookId || null,
    status: card.status,
    created_at: card.addedAt || new Date().toISOString(),
  };
}

/** Drops the entry only if it is still the write that was just confirmed. */
function settleCard(card: Flashcard, ok: boolean) {
  const outbox = read();
  const entry = outbox.cards[card.id];
  if (!entry || JSON.stringify(entry.card) !== JSON.stringify(card)) return;
  if (ok || entry.tries + 1 >= MAX_TRIES) delete outbox.cards[card.id];
  else entry.tries += 1;
  write(outbox);
}

function settleVariant(key: string, progress: SkillProgress, ok: boolean) {
  const outbox = read();
  const entry = outbox.variants[key];
  if (!entry || JSON.stringify(entry.progress) !== JSON.stringify(progress)) return;
  if (ok || entry.tries + 1 >= MAX_TRIES) delete outbox.variants[key];
  else entry.tries += 1;
  write(outbox);
}

/** Saves a card to the account, remembering it until the server confirms. */
export async function pushCard(userId: string, card: Flashcard): Promise<boolean> {
  const outbox = read();
  outbox.cards[card.id] = { card, tries: outbox.cards[card.id]?.tries ?? 0 };
  delete outbox.deletes[card.id];
  write(outbox);
  const ok = await sbUpsertFlashcard(flashcardToDb(card, userId)).catch(() => false);
  settleCard(card, ok);
  return ok;
}

/** The same for one direction's («Вспоминаю» / «Слушаю») own schedule. */
export async function pushCardVariant(userId: string, cardId: string, variant: SideVariant, progress: SkillProgress): Promise<boolean> {
  const key = variantKey(cardId, variant);
  const outbox = read();
  outbox.variants[key] = { progress, tries: outbox.variants[key]?.tries ?? 0 };
  write(outbox);
  const ok = await sbUpsertCardVariantProgress(userId, [{ cardId, variant, progress }]).catch(() => false);
  settleVariant(key, progress, ok);
  return ok;
}

export async function pushCardDeletes(userId: string, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const outbox = read();
  for (const id of ids) {
    outbox.deletes[id] = outbox.deletes[id] ?? 0;
    delete outbox.cards[id];
    for (const key of Object.keys(outbox.variants)) if (key.startsWith(`${id}|`)) delete outbox.variants[key];
  }
  write(outbox);
  const ok = await sbDeleteFlashcards(ids).catch(() => false);
  const after = read();
  for (const id of ids) {
    if (!(id in after.deletes)) continue;
    if (ok || after.deletes[id] + 1 >= MAX_TRIES) delete after.deletes[id];
    else after.deletes[id] += 1;
  }
  write(after);
  return ok;
}

let flushing: Promise<void> | null = null;

/** Sends everything still waiting. Safe to call often; overlapping calls share one run. */
export function flushCardOutbox(userId: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (flushing) return flushing;
  flushing = (async () => {
    const outbox = read();
    const deletes = Object.keys(outbox.deletes);
    if (deletes.length) await pushCardDeletes(userId, deletes);

    for (const { card } of Object.values(outbox.cards)) {
      const ok = await sbUpsertFlashcard(flashcardToDb(card, userId)).catch(() => false);
      settleCard(card, ok);
      // Offline: the rest would fail the same way.
      if (!ok && typeof navigator !== "undefined" && navigator.onLine === false) return;
    }

    const variants = Object.entries(outbox.variants);
    if (variants.length) {
      const writes: CardVariantProgressWrite[] = variants.map(([key, { progress }]) => {
        const [cardId, variant] = key.split("|") as [string, SideVariant];
        return { cardId, variant, progress };
      });
      const ok = await sbUpsertCardVariantProgress(userId, writes).catch(() => false);
      for (const [key, { progress }] of variants) settleVariant(key, progress, ok);
    }
  })().catch(() => undefined).finally(() => { flushing = null; });
  return flushing;
}

/** How many writes are waiting — for a «не всё сохранено» hint. */
export function pendingCardWrites(): number {
  const outbox = read();
  return Object.keys(outbox.cards).length + Object.keys(outbox.variants).length + Object.keys(outbox.deletes).length;
}

/**
 * Lays the pending cards over a deck read from somewhere else (the local
 * mirror, the account), so an answer that has not been confirmed yet is never
 * replaced by the older copy.
 */
export function overlayPendingCards(cards: Flashcard[]): Flashcard[] {
  const outbox = read();
  const pendingIds = Object.keys(outbox.cards);
  const deleted = outbox.deletes;
  if (pendingIds.length === 0 && Object.keys(deleted).length === 0) return cards;
  const seen = new Set<string>();
  const result: Flashcard[] = [];
  for (const card of cards) {
    if (card.id in deleted) continue;
    seen.add(card.id);
    result.push(outbox.cards[card.id]?.card ?? card);
  }
  // A card created on this device that the account has not got yet.
  for (const id of pendingIds) if (!seen.has(id)) result.unshift(outbox.cards[id].card);
  return result;
}

/** Pending per-direction schedules, for laying over the variant map the same way. */
export function pendingCardVariants(): Array<{ cardId: string; variant: SideVariant; progress: SkillProgress }> {
  return Object.entries(read().variants).map(([key, { progress }]) => {
    const [cardId, variant] = key.split("|") as [string, SideVariant];
    return { cardId, variant, progress };
  });
}
