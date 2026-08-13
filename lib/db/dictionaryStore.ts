// Reading and writing the learner's dictionary.
//
// Entries are keyed by lemma, so photographing the same coursebook page twice
// updates what is there instead of doubling it. An update never blanks a field
// that the new reading happened not to see: a second, blurrier photo must not
// erase the plural form the first one got right.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";

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

export async function saveDictionaryEntries(
  admin: SupabaseClient,
  userId: string,
  language: string,
  drafts: DictionaryEntryDraft[],
  source: string,
  batchId: string | null = null,
): Promise<SaveEntriesResult> {
  if (drafts.length === 0) return { ok: true, added: 0, updated: 0 };

  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const { data: existingRows, error: readError } = await admin
    .from("dictionary_entries")
    .select("id, lemma, headword, plural, forms, example, example_translation, note, cefr, translation")
    .eq("user_id", userId)
    .eq("language", language);

  if (readError) return { ok: false, error: `Не удалось прочитать словарь: ${readError.message}` };

  const existingMap = new Map<string, Record<string, unknown>>();
  for (const row of existingRows ?? []) {
    const lemmaKey = norm(String(row.lemma ?? ""));
    const headwordKey = norm(String(row.headword ?? ""));
    if (lemmaKey) existingMap.set(lemmaKey, row);
    if (headwordKey) existingMap.set(headwordKey, row);
  }

  let addedCount = 0;
  let updatedCount = 0;

  const rows = drafts.map((d) => {
    const key = norm(d.lemma || d.headword);
    const prior = existingMap.get(key) || existingMap.get(norm(d.headword));
    if (prior) {
      updatedCount++;
    } else {
      addedCount++;
    }
    // Prefer what this reading found; fall back to what was already known.
    const keep = (next: string, old: unknown) => next || String(old ?? "");
    return {
      ...(prior?.id ? { id: prior.id } : {}),
      user_id: userId,
      language,
      batch_id: batchId,
      headword: d.headword,
      lemma: d.lemma,
      translation: keep(d.translation, prior?.translation),
      part_of_speech: d.partOfSpeech,
      gender: d.gender,
      article: d.article,
      plural: keep(d.plural, prior?.plural),
      forms: Object.keys(d.forms ?? {}).length > 0 ? d.forms : (prior?.forms ?? {}),
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
): Promise<{ created: number; relinked: number }> {
  if (entries.length === 0) return { created: 0, relinked: 0 };

  const { data: existing } = await admin
    .from("flashcards")
    .select("id, front, source_book_id")
    .eq("user_id", userId);

  const existingCardsMap = new Map(
    (existing ?? []).map((row) => [normalizeFront(String(row.front ?? "")), row]),
  );

  // Due at the end of today, so a freshly photographed page is ready to study
  // in the same sitting.
  const dueAt = new Date();
  dueAt.setHours(23, 59, 59, 999);

  const newRows: Record<string, unknown>[] = [];
  const relinkIds: string[] = [];

  for (const e of entries) {
    const key = normalizeFront(e.headword);
    const matchedCard = existingCardsMap.get(key);

    if (matchedCard) {
      if (matchedCard.id) relinkIds.push(String(matchedCard.id));
    } else {
      newRows.push({
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

  if (relinkIds.length > 0) {
    const { error: relinkError } = await admin
      .from("flashcards")
      .update({ source_book_id: batchId, source_book_title: batchTitle })
      .in("id", relinkIds);

    if (relinkError) {
      console.error("relinkCardsForEntries error:", relinkError.message);
    }
  }

  if (newRows.length > 0) {
    const { error } = await admin.from("flashcards").insert(newRows);
    if (error) {
      console.error("createCardsForEntries:", error.message);
      return { created: 0, relinked: relinkIds.length };
    }
  }

  return { created: newRows.length, relinked: relinkIds.length };
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
