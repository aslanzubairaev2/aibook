// Reading and writing the learner's dictionary.
//
// Entries are keyed by lemma, so photographing the same coursebook page twice
// updates what is there instead of doubling it. An update never blanks a field
// that the new reading happened not to see: a second, blurrier photo must not
// erase the plural form the first one got right.

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyNounFieldRules, type DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";

export type DictionaryBatch = {
  id: string;
  title: string;
  kind: string;
  topic: string;
  language: string;
  word_count: number;
  created_at: string;
};

export type DictionaryEntry = {
  id: string;
  batch_id: string | null;
  headword: string;
  lemma: string;
  language: string;
  translation: string;
  part_of_speech: string;
  gender: string;
  article: string;
  plural: string;
  forms: Record<string, string>;
  cefr: string;
  note: string;
  example: string;
  example_translation: string;
  source: string;
  created_at: string;
};

export const DICTIONARY_COLUMNS =
  "id, batch_id, headword, lemma, language, translation, part_of_speech, gender, article, plural, forms, cefr, note, example, example_translation, source, created_at";

export type SaveEntriesResult =
  | { ok: true; added: number; updated: number }
  | { ok: false; error: string };

export type CreateCardsResult =
  | { ok: true; created: number; relinked: number }
  | { ok: false; error: string };

function normalizeDictionaryKey(value: string): string {
  // German capitalization is semantic: "Morgen" (morning) and "morgen"
  // (tomorrow), or "Essen" (food) and "essen" (to eat), are different
  // dictionary entries. Whitespace is formatting; case is data.
  return value.trim().replace(/\s+/g, " ");
}

export function dedupeDictionaryDrafts(drafts: DictionaryEntryDraft[]): DictionaryEntryDraft[] {
  const seen = new Set<string>();
  const unique: DictionaryEntryDraft[] = [];

  for (const draft of drafts) {
    const key = normalizeDictionaryKey(draft.lemma || draft.headword);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(draft);
  }

  return unique;
}

export async function saveDictionaryEntries(
  admin: SupabaseClient,
  userId: string,
  language: string,
  drafts: DictionaryEntryDraft[],
  source: string,
  batchId: string | null = null,
): Promise<SaveEntriesResult> {
  if (drafts.length === 0) return { ok: true, added: 0, updated: 0 };

  const uniqueDrafts = dedupeDictionaryDrafts(drafts);

  const { data: existingRows, error: readError } = await admin
    .from("dictionary_entries")
    .select("id, lemma, headword, plural, forms, example, example_translation, note, cefr, translation")
    .eq("user_id", userId)
    .eq("language", language);

  if (readError) return { ok: false, error: `Не удалось прочитать словарь: ${readError.message}` };

  const existingByLemma = new Map<string, Record<string, unknown>>();
  const existingByHeadword = new Map<string, Record<string, unknown>>();
  for (const row of existingRows ?? []) {
    const lemmaKey = normalizeDictionaryKey(String(row.lemma ?? ""));
    const headwordKey = normalizeDictionaryKey(String(row.headword ?? ""));
    if (lemmaKey) existingByLemma.set(lemmaKey, row);
    if (headwordKey && !existingByHeadword.has(headwordKey)) {
      existingByHeadword.set(headwordKey, row);
    }
  }

  let addedCount = 0;
  let updatedCount = 0;

  const rows = uniqueDrafts.map((d) => {
    const lemmaKey = normalizeDictionaryKey(d.lemma || d.headword);
    const headwordKey = normalizeDictionaryKey(d.headword);
    const prior = existingByLemma.get(lemmaKey) || existingByHeadword.get(headwordKey);
    if (prior) updatedCount++;
    else addedCount++;

    // Prefer what this reading found; fall back to what was already known.
    const keep = (next: string, old: unknown) => next || String(old ?? "");

    // The fallback has one exception. A verb that was once stored with a noun's
    // plural — the row-slip a photograph occasionally produces — would inherit
    // that plural back on every later reading, since the correct new value is
    // the empty string. Re-applying the noun rule to the merged result is what
    // lets a bad field actually be cleared.
    const merged = applyNounFieldRules({
      ...d,
      plural: keep(d.plural, prior?.plural),
      forms: Object.keys(d.forms ?? {}).length > 0 ? d.forms : ((prior?.forms ?? {}) as Record<string, string>),
    });

    return {
      user_id: userId,
      language,
      batch_id: batchId,
      headword: d.headword,
      // If the model changed only capitalization on a later photo, retain the
      // exact natural key already stored. Most importantly, never include the
      // row id in an upsert resolved by this different natural key: doing so can
      // move another row's primary key onto the conflicting row.
      lemma: prior ? String(prior.lemma) : lemmaKey,
      translation: keep(d.translation, prior?.translation),
      part_of_speech: d.partOfSpeech,
      gender: merged.gender,
      article: merged.article,
      plural: merged.plural,
      forms: merged.forms ?? {},
      cefr: keep(d.cefr, prior?.cefr),
      note: keep(d.note ?? "", prior?.note),
      example: keep(d.example ?? "", prior?.example),
      example_translation: keep(d.exampleTranslation ?? "", prior?.example_translation),
      source: source.slice(0, 200),
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await admin
    .from("dictionary_entries")
    .upsert(rows, { onConflict: "user_id,lemma,language" });

  if (error) return { ok: false, error: `Не удалось сохранить слова: ${error.message}` };

  return { ok: true, added: addedCount, updated: updatedCount };
}

/**
 * Every word of a batch becomes a flashcard straight away.
 *
 * The learner photographed a page they have been told to learn; making them
 * tap "add to cards" forty times to actually start learning it is a chore with
 * no purpose. Cards carry the batch id, which is what lets the deck be
 * narrowed to one page, and the CEFR level, which is what lets it be narrowed
 * by difficulty.
 *
 * Words that are already cards are re-linked to the new batch without resetting
 * their SRS progress — re-adding one must not reset a schedule the learner has
 * been building for weeks.
 */
export async function createCardsForEntries(
  admin: SupabaseClient,
  userId: string,
  entries: DictionaryEntryDraft[],
  batchId: string,
  batchTitle: string,
): Promise<CreateCardsResult> {
  if (entries.length === 0) return { ok: true, created: 0, relinked: 0 };

  const { data: existing, error: readError } = await admin
    .from("flashcards")
    .select("id, front, source_book_id")
    .eq("user_id", userId);

  if (readError) {
    return { ok: false, error: `Не удалось проверить существующие карточки: ${readError.message}` };
  }

  const existingCardsMap = new Map<string, Record<string, unknown>[]>();
  for (const row of existing ?? []) {
    const key = normalizeFront(String(row.front ?? ""));
    if (!key) continue;
    const matches = existingCardsMap.get(key) ?? [];
    matches.push(row);
    existingCardsMap.set(key, matches);
  }

  // Due at the end of today, so a freshly photographed page is ready to study
  // in the same sitting.
  const dueAt = new Date();
  dueAt.setHours(23, 59, 59, 999);

  const newRows: Record<string, unknown>[] = [];
  const relinkIds = new Set<string>();
  const seenFronts = new Set<string>();

  for (const e of entries) {
    const key = normalizeFront(e.headword);
    if (!key || seenFronts.has(key)) continue;
    seenFronts.add(key);
    const matchedCards = existingCardsMap.get(key) ?? [];

    if (matchedCards.length > 0) {
      for (const matchedCard of matchedCards) {
        if (matchedCard.id) relinkIds.add(String(matchedCard.id));
      }
    } else {
      newRows.push({
        id: crypto.randomUUID(),
        user_id: userId,
        vocabulary_item_id: null,
        front: e.headword,
        back: cardBack(e),
        source_book_title: batchTitle,
        source_book_id: batchId,
        selection_type: "word",
        repetitions: 0,
        lapses: 0,
        easiness_factor: 2.5,
        interval_days: 0,
        next_review_at: dueAt.toISOString(),
        last_reviewed_at: null,
        status: "new",
        cefr: e.cefr || null,
      });
    }
  }

  // Insert first. A failed insert leaves existing schedules untouched. If the
  // following re-link fails, these known ids let us compensate safely.
  if (newRows.length > 0) {
    const { error } = await admin.from("flashcards").insert(newRows);
    if (error) {
      return { ok: false, error: `Не удалось создать карточки: ${error.message}` };
    }
  }

  if (relinkIds.size > 0) {
    const { error: relinkError } = await admin
      .from("flashcards")
      .update({ source_book_id: batchId, source_book_title: batchTitle })
      .in("id", [...relinkIds]);

    if (relinkError) {
      if (newRows.length > 0) {
        const newIds = newRows.map((row) => String(row.id));
        const { error: cleanupError } = await admin.from("flashcards").delete().in("id", newIds);
        if (cleanupError) {
          console.error("cleanupCardsForEntries error:", cleanupError.message);
        }
      }
      return { ok: false, error: `Не удалось привязать прежние карточки к новой пачке: ${relinkError.message}` };
    }
  }

  return { ok: true, created: newRows.length, relinked: relinkIds.size };
}

export async function discardDictionaryBatch(
  admin: SupabaseClient,
  userId: string,
  batchId: string,
): Promise<string | null> {
  const { error } = await admin
    .from("dictionary_batches")
    .delete()
    .eq("id", batchId)
    .eq("user_id", userId);

  return error?.message ?? null;
}

function normalizeFront(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The back of the card carries the cheat sheet, not just the translation. */
export function cardBack(entry: DictionaryEntryDraft): string {
  const extras = [
    entry.plural && `мн. ч.: ${entry.plural}`,
    ...Object.entries(entry.forms ?? {}).map(([k, v]) => `${k}: ${v}`),
  ].filter(Boolean);
  return extras.length > 0 ? `${entry.translation}\n${extras.join(" · ")}` : entry.translation;
}
