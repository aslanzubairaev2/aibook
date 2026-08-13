import assert from "node:assert/strict";
import test from "node:test";
import { createCardsForEntries, saveDictionaryEntries } from "./dictionaryStore.ts";
import type { DictionaryEntryDraft } from "../ai/buildDictionaryPrompt.ts";

function createMockSupabase() {
  const dictionaryEntries: Record<string, unknown>[] = [];
  const flashcards: Record<string, unknown>[] = [];

  return {
    dictionaryEntries,
    flashcards,
    from(table: string) {
      if (table === "dictionary_entries") {
        return {
          select() {
            return {
              eq() {
                return {
                  eq() {
                    return Promise.resolve({ data: dictionaryEntries, error: null });
                  },
                };
              },
            };
          },
          upsert(rows: Record<string, unknown>[]) {
            for (const row of rows) {
              const id = row.id ? String(row.id) : `entry-${dictionaryEntries.length + 1}`;
              const idx = dictionaryEntries.findIndex((e) => e.id === id || e.lemma === row.lemma);
              if (idx >= 0) {
                dictionaryEntries[idx] = { ...dictionaryEntries[idx], ...row, id };
              } else {
                dictionaryEntries.push({ ...row, id });
              }
            }
            return Promise.resolve({ error: null });
          },
        };
      }

      if (table === "flashcards") {
        return {
          select() {
            return {
              eq() {
                return Promise.resolve({ data: flashcards, error: null });
              },
            };
          },
          update(patch: Record<string, unknown>) {
            return {
              in(_column: string, ids: string[]) {
                for (const id of ids) {
                  const card = flashcards.find((c) => c.id === id);
                  if (card) Object.assign(card, patch);
                }
                return Promise.resolve({ error: null });
              },
            };
          },
          insert(rows: Record<string, unknown>[]) {
            for (const r of rows) {
              flashcards.push({ ...r, id: `card-${flashcards.length + 1}` });
            }
            return Promise.resolve({ error: null });
          },
        };
      }

      throw new Error(`Unknown table: ${table}`);
    },
  };
}

test("saveDictionaryEntries updates existing entries without creating duplicates", async () => {
  const mockDb = createMockSupabase();

  const drafts1: DictionaryEntryDraft[] = [
    { headword: "der Ball", lemma: "Ball", translation: "мяч", partOfSpeech: "существительное", gender: "m", article: "der", plural: "Bälle", cefr: "A1" },
  ];

  const res1 = await saveDictionaryEntries(mockDb as never, "user-1", "de", drafts1, "Batch 1", "batch-1");
  assert.equal(res1.ok, true);
  if (res1.ok) {
    assert.equal(res1.added, 1);
    assert.equal(res1.updated, 0);
  }
  assert.equal(mockDb.dictionaryEntries.length, 1);

  // Re-saving same word with new batch ID
  const drafts2: DictionaryEntryDraft[] = [
    { headword: "der Ball", lemma: "ball", translation: "мяч (новый снимок)", partOfSpeech: "существительное", gender: "m", article: "der", plural: "Bälle", cefr: "A1" },
  ];

  const res2 = await saveDictionaryEntries(mockDb as never, "user-1", "de", drafts2, "Batch 2", "batch-2");
  assert.equal(res2.ok, true);
  if (res2.ok) {
    assert.equal(res2.added, 0);
    assert.equal(res2.updated, 1);
  }
  // Total entries count remains 1 (no duplicates inserted)
  assert.equal(mockDb.dictionaryEntries.length, 1);
  assert.equal(mockDb.dictionaryEntries[0].batch_id, "batch-2");
});

test("saveDictionaryEntries deduplicates duplicate drafts inside the same photo payload", async () => {
  const mockDb = createMockSupabase();

  const duplicateDrafts: DictionaryEntryDraft[] = [
    { headword: "der Ball", lemma: "Ball", translation: "мяч", partOfSpeech: "существительное", gender: "m", article: "der", plural: "Bälle", cefr: "A1" },
    { headword: "Ball", lemma: "Ball", translation: "мяч (дубликат в том же снимке)", partOfSpeech: "существительное", gender: "m", article: "der", plural: "Bälle", cefr: "A1" },
  ];

  const res = await saveDictionaryEntries(mockDb as never, "user-1", "de", duplicateDrafts, "Batch Dupes", "batch-dupes");
  assert.equal(res.ok, true);
  // Only 1 entry saved
  assert.equal(mockDb.dictionaryEntries.length, 1);
});

test("createCardsForEntries re-links existing cards without creating duplicate cards or resetting SRS", async () => {
  const mockDb = createMockSupabase();

  const drafts: DictionaryEntryDraft[] = [
    { headword: "der Ball", lemma: "Ball", translation: "мяч", partOfSpeech: "существительное", gender: "m", article: "der", plural: "Bälle", cefr: "A1" },
  ];

  // Initial creation of card for batch-1
  const res1 = await createCardsForEntries(mockDb as never, "user-1", drafts, "batch-1", "Batch 1");
  assert.equal(res1.created, 1);
  assert.equal(res1.relinked, 0);
  assert.equal(mockDb.flashcards.length, 1);
  assert.equal(mockDb.flashcards[0].source_book_id, "batch-1");

  // Simulate user reviewing card (repetitions > 0)
  mockDb.flashcards[0].repetitions = 5;

  // Re-photographing page creates batch-2
  const res2 = await createCardsForEntries(mockDb as never, "user-1", drafts, "batch-2", "Batch 2");
  assert.equal(res2.created, 0);
  assert.equal(res2.relinked, 1);

  // Flashcards count remains 1
  assert.equal(mockDb.flashcards.length, 1);
  // Re-linked to new batch-2
  assert.equal(mockDb.flashcards[0].source_book_id, "batch-2");
  // SRS progress intact!
  assert.equal(mockDb.flashcards[0].repetitions, 5);
});
