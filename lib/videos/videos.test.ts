import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_VIDEOS,
  GERMAN_VIDEOS,
  ENGLISH_VIDEOS,
  getVideosByLanguage,
  filterVideos,
  findVideosForWord,
  findVideosForBook,
} from "./data/index.ts";

test("videos dataset contains German and English videos", () => {
  assert.ok(ALL_VIDEOS.length > 0);
  assert.ok(GERMAN_VIDEOS.length >= 8, "Should have rich German video collection");
  assert.ok(ENGLISH_VIDEOS.length >= 4, "Should have English video collection");
});

test("getVideosByLanguage returns correct subsets", () => {
  const de = getVideosByLanguage("de");
  assert.equal(de.length, GERMAN_VIDEOS.length);
  assert.ok(de.every((v) => v.language === "de"));

  const en = getVideosByLanguage("en");
  assert.equal(en.length, ENGLISH_VIDEOS.length);
  assert.ok(en.every((v) => v.language === "en"));
});

test("filterVideos filters by CEFR level", () => {
  const a1 = filterVideos(GERMAN_VIDEOS, { cefrLevel: "A1" });
  assert.ok(a1.length > 0);
  assert.ok(a1.every((v) => v.cefrLevel === "A1" || v.cefrLevel === "all"));

  const a2 = filterVideos(GERMAN_VIDEOS, { cefrLevel: "A2" });
  assert.ok(a2.length > 0);
  assert.ok(a2.every((v) => v.cefrLevel === "A2" || v.cefrLevel === "all"));
});

test("filterVideos filters by category", () => {
  const dialogues = filterVideos(GERMAN_VIDEOS, { category: "dialogues" });
  assert.ok(dialogues.length > 0);
  assert.ok(dialogues.every((v) => v.category === "dialogues"));
});

test("findVideosForWord finds relevant German video for target vocabulary", () => {
  const dogVideos = findVideosForWord("der Hund", "de");
  assert.ok(dogVideos.length > 0, "Should find video with Hund");
  assert.ok(dogVideos.some((v) => v.keyVocabulary?.some((k) => k.word === "der Hund")));

  const furnitureVideos = findVideosForWord("der Tisch", "de");
  assert.ok(furnitureVideos.length > 0, "Should find video with Tisch");
});

test("findVideosForBook finds relevant videos for book titles", () => {
  const travelVideos = findVideosForBook("Der größte Schatz", "de");
  assert.ok(travelVideos.length > 0);
});
