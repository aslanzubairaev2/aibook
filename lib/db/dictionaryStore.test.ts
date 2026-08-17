import assert from "node:assert/strict";
import test from "node:test";
import { createCardsForEntries, findOrCreatePack, readBatches, saveDictionaryEntries } from "./dictionaryStore.ts";
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
              const naturalKeyIndex = dictionaryEntries.findIndex(
                (e) => e.user_id === row.user_id && e.lemma === row.lemma && e.language === row.language,
              );
              const requestedIdIndex = row.id
                ? dictionaryEntries.findIndex((e) => e.id === row.id)
                : -1;

              // PostgreSQL resolves this upsert by the natural unique key. If
              // the payload also supplies an id already owned by another row,
              // updating the conflicting row would violate the primary key.
              if (
                naturalKeyIndex >= 0
                && requestedIdIndex >= 0
                && naturalKeyIndex !== requestedIdIndex
              ) {
                return Promise.resolve({
                  error: { message: 'duplicate key value violates unique constraint "dictionary_entries_pkey"' },
                });
              }

              if (naturalKeyIndex >= 0) {
                dictionaryEntries[naturalKeyIndex] = {
                  ...dictionaryEntries[naturalKeyIndex],
                  ...row,
                  id: dictionaryEntries[naturalKeyIndex].id,
                };
              } else {
                const id = row.id ? String(row.id) : `entry-${dictionaryEntries.length + 1}`;
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
              flashcards.push({ ...r, id: r.id ?? `card-${flashcards.length + 1}` });
            }
            return Promise.resolve({ error: null });
          },
          delete() {
            return {
              in(_column: string, ids: string[]) {
                for (let i = flashcards.length - 1; i >= 0; i--) {
                  if (ids.includes(String(flashcards[i].id))) flashcards.splice(i, 1);
                }
                return Promise.resolve({ error: null });
              },
            };
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

// "Never blank a field a blurrier photo missed" is right for a plural the first
// reading got right — and wrong for one that was never the word's to begin
// with. A verb stored with a noun's plural has to be able to lose it.
test("saveDictionaryEntries lets a re-read clear a plural that never belonged to a verb", async () => {
  const mockDb = createMockSupabase();
  mockDb.dictionaryEntries.push({
    id: "verb-id",
    user_id: "user-1",
    language: "de",
    headword: "ausgehen",
    lemma: "ausgehen",
    translation: "выходить",
    plural: "die Zeitungen",
    forms: {},
    cefr: "A1",
  });

  const reread: DictionaryEntryDraft[] = [
    { headword: "ausgehen", lemma: "ausgehen", translation: "выходить", partOfSpeech: "глагол", gender: "", article: "", plural: "", cefr: "A1" },
  ];

  const res = await saveDictionaryEntries(mockDb as never, "user-1", "de", reread, "Batch 2", "batch-2");
  assert.equal(res.ok, true);
  assert.equal(mockDb.dictionaryEntries.length, 1);
  assert.equal(mockDb.dictionaryEntries[0].plural, "", "the verb keeps no plural after a clean reading");
});

test("saveDictionaryEntries still restores a noun's plural that one photo missed", async () => {
  const mockDb = createMockSupabase();
  mockDb.dictionaryEntries.push({
    id: "noun-id",
    user_id: "user-1",
    language: "de",
    headword: "die Zeitung",
    lemma: "Zeitung",
    translation: "газета",
    plural: "die Zeitungen",
    forms: {},
    cefr: "A1",
  });

  const blurry: DictionaryEntryDraft[] = [
    { headword: "die Zeitung", lemma: "Zeitung", translation: "газета", partOfSpeech: "существительное", gender: "f", article: "die", plural: "", cefr: "A1" },
  ];

  const res = await saveDictionaryEntries(mockDb as never, "user-1", "de", blurry, "Batch 2", "batch-2");
  assert.equal(res.ok, true);
  assert.equal(mockDb.dictionaryEntries[0].plural, "die Zeitungen");
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

test("saveDictionaryEntries never moves a primary key between case-sensitive German lemmas", async () => {
  const mockDb = createMockSupabase();
  mockDb.dictionaryEntries.push(
    {
      id: "noun-id",
      user_id: "user-1",
      language: "de",
      lemma: "Morgen",
      headword: "der Morgen",
      translation: "утро",
      part_of_speech: "существительное",
    },
    {
      id: "adverb-id",
      user_id: "user-1",
      language: "de",
      lemma: "morgen",
      headword: "morgen",
      translation: "завтра",
      part_of_speech: "наречие",
    },
  );

  const result = await saveDictionaryEntries(
    mockDb as never,
    "user-1",
    "de",
    [{
      headword: "der Morgen",
      lemma: "Morgen",
      translation: "утро",
      partOfSpeech: "существительное",
      gender: "m",
      article: "der",
      plural: "Morgen",
      cefr: "A1",
    }],
    "Повторное фото",
    "batch-2",
  );

  assert.deepEqual(result, { ok: true, added: 0, updated: 1 });
  assert.equal(mockDb.dictionaryEntries.length, 2);
  assert.equal(mockDb.dictionaryEntries[0].id, "noun-id");
  assert.equal(mockDb.dictionaryEntries[0].batch_id, "batch-2");
  assert.equal(mockDb.dictionaryEntries[1].id, "adverb-id");
  assert.equal(mockDb.dictionaryEntries[1].translation, "завтра");
});

test("createCardsForEntries re-links existing cards without creating duplicate cards or resetting SRS", async () => {
  const mockDb = createMockSupabase();

  const drafts: DictionaryEntryDraft[] = [
    { headword: "der Ball", lemma: "Ball", translation: "мяч", partOfSpeech: "существительное", gender: "m", article: "der", plural: "Bälle", cefr: "A1" },
  ];

  // Initial creation of card for batch-1
  const res1 = await createCardsForEntries(mockDb as never, "user-1", drafts, "batch-1", "Batch 1");
  assert.deepEqual(res1, { ok: true, created: 1, relinked: 0 });
  assert.equal(mockDb.flashcards.length, 1);
  assert.equal(mockDb.flashcards[0].source_book_id, "batch-1");

  // Simulate user reviewing card (repetitions > 0)
  mockDb.flashcards[0].repetitions = 5;

  // Re-photographing page creates batch-2
  const res2 = await createCardsForEntries(mockDb as never, "user-1", drafts, "batch-2", "Batch 2");
  assert.deepEqual(res2, { ok: true, created: 0, relinked: 1 });

  // Flashcards count remains 1
  assert.equal(mockDb.flashcards.length, 1);
  // Re-linked to new batch-2
  assert.equal(mockDb.flashcards[0].source_book_id, "batch-2");
  // SRS progress intact!
  assert.equal(mockDb.flashcards[0].repetitions, 5);
});

// ─── Packs ──────────────────────────────────────────────────────────────────
//
// A pack is no longer only a photographed page of words: a set of phrases an
// assistant built is one too, and it has to survive a deployment whose database
// has not learned about training preferences yet.

/** A batches table that behaves like PostgREST, optionally without the newest column. */
function createBatchesDb(rows: Record<string, unknown>[], hasTrainingColumn = true) {
  const inserted: Record<string, unknown>[] = [];

  const selectChain = (columns: string, filters: Record<string, unknown>) => {
    const result = () => {
      if (!hasTrainingColumn && columns.includes("training")) {
        return Promise.resolve({
          data: null,
          error: { message: 'column dictionary_batches.training does not exist' },
        });
      }
      const matched = rows.filter((row) => Object.entries(filters).every(([k, v]) => row[k] === v));
      return Promise.resolve({ data: matched, error: null });
    };
    const chain = {
      eq: (column: string, value: unknown) => selectChain(columns, { ...filters, [column]: value }),
      order: () => chain,
      limit: () => result(),
      then: (...args: Parameters<Promise<unknown>["then"]>) => result().then(...args),
    };
    return chain;
  };

  return {
    rows,
    inserted,
    from() {
      return {
        select: (columns: string) => selectChain(columns, {}),
        insert: (row: Record<string, unknown>) => ({
          select: () => ({
            single: () => {
              const stored = { ...row, id: `pack-${rows.length + 1}` };
              rows.push(stored);
              inserted.push(stored);
              return Promise.resolve({ data: { id: stored.id }, error: null });
            },
          }),
        }),
      };
    },
  };
}

test("packs still load on a database that has not run the training migration", async () => {
  const db = createBatchesDb([{ id: "pack-1", user_id: "user-1", title: "Страница 56" }], false);

  const { batches, error } = await readBatches(db as never, "user-1");

  assert.equal(error, null);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].title, "Страница 56");
});

test("a pack is reused by title instead of being created twice", async () => {
  const db = createBatchesDb([
    { id: "pack-1", user_id: "user-1", title: "Akkusativ · фразы", created_at: "2026-08-16T10:00:00.000Z" },
  ]);

  const again = await findOrCreatePack(db as never, "user-1", { title: "Akkusativ · фразы", language: "de" });
  assert.deepEqual(again, { ok: true, id: "pack-1", created: false });
  assert.equal(db.inserted.length, 0);

  const fresh = await findOrCreatePack(db as never, "user-1", {
    title: "Dativ · фразы",
    language: "de",
    training: { variants: ["reverse"] },
  });
  assert.equal(fresh.ok && fresh.created, true);
  assert.deepEqual(db.inserted[0].training, { variants: ["reverse"] });
  // A pack of phrases holds no dictionary words, and must not claim to.
  assert.equal(db.inserted[0].word_count, 0);
});
