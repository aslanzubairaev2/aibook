import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildLearnerSnapshot } from "./learnerSnapshot.ts";
import { mergeGrammarPatterns } from "./grammarContext.ts";
import type { Book, Flashcard } from "../types.ts";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function card(front: string, overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: front,
    type: "word",
    front,
    back: "",
    source: "test",
    addedAt: new Date(NOW - 60 * DAY).toISOString(),
    status: "review",
    repetitions: 3,
    lapses: 0,
    intervalDays: 6,
    easeFactor: 2.5,
    dueAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

function book(overrides: Partial<Book>): Book {
  return {
    id: "b", title: "T", author: "A", language: "de", format: "txt", progress: 10, paragraphIndex: 0,
    chapterTitle: "", lastReadAt: new Date(NOW).toISOString(), coverColor: "#000", paragraphs: [],
    ...overrides,
  };
}

describe("learner snapshot for the discussion", () => {
  test("forgotten words come first by lapses, the tapped word is left out", () => {
    const snap = buildLearnerSnapshot(
      [card("die Rechnung", { lapses: 4 }), card("buchen", { lapses: 3 }), card("aufräumen", { lapses: 5 }), card("gut")],
      [], "de", "aufräumen", NOW,
    );
    assert.deepEqual(snap.strugglingWords, ["die Rechnung", "buchen"]);
  });

  test("recent words are the last two weeks, newest first, long sentences skipped", () => {
    const snap = buildLearnerSnapshot(
      [
        card("alt"),
        card("gestern", { addedAt: new Date(NOW - 1 * DAY).toISOString() }),
        card("heute", { addedAt: new Date(NOW).toISOString() }),
        card("Das ist ein sehr langer Satz, der nicht als Wort taugt.", { addedAt: new Date(NOW).toISOString() }),
      ],
      [], "de", "x", NOW,
    );
    assert.deepEqual(snap.recentWords, ["heute", "gestern"]);
    assert.equal(snap.totalWordCount, 4);
  });

  test("current book is the most recently read unfinished one in the target language", () => {
    const snap = buildLearnerSnapshot([], [
      book({ id: "1", title: "Old", lastReadAt: new Date(NOW - 5 * DAY).toISOString() }),
      book({ id: "2", title: "Now", lastReadAt: new Date(NOW).toISOString(), progress: 42.4, cefrLevel: "B1" }),
      book({ id: "3", title: "English", language: "en", lastReadAt: new Date(NOW + DAY).toISOString() }),
      book({ id: "4", title: "Done", progress: 100, lastReadAt: new Date(NOW + DAY).toISOString() }),
    ], "de", "x", NOW);
    assert.equal(snap.currentBook?.title, "Now");
    assert.equal(snap.currentBook?.progress, 42);
  });

  test("an empty deck gives an empty snapshot, not zeros", () => {
    assert.deepEqual(buildLearnerSnapshot([], [], "de", "x", NOW), {});
  });
});

describe("grammar memory", () => {
  test("a repeated pattern is counted and stamped, ordering is by recency", () => {
    const first = mergeGrammarPatterns([], [{ patternId: "v2", patternLabel: "V2" }], "2026-10-01T00:00:00Z");
    const second = mergeGrammarPatterns(first, [{ patternId: "perfekt", patternLabel: "Perfekt" }], "2026-10-02T00:00:00Z");
    const third = mergeGrammarPatterns(second, [{ patternId: "V2", patternLabel: "V2" }], "2026-10-03T00:00:00Z");
    assert.deepEqual(third.map((e) => [e.patternId, e.count]), [["v2", 2], ["perfekt", 1]]);
    assert.equal(third[0].lastSeenAt, "2026-10-03T00:00:00Z");
    // the input is not mutated
    assert.equal(first[0].count, 1);
  });
});
