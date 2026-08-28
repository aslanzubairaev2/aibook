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
import { fetchYouTubeTranscript, normalizeSubtitleCues } from "./youtubeTranscript.ts";
import { inferVideoCategory, inferVideoLevel } from "./youtubeSearch.ts";

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
  const dogVideos = findVideosForWord("Hund", "de");
  assert.ok(dogVideos.length > 0, "Should find video with Hund");

  const nicoVideos = findVideosForWord("Nico", "de");
  assert.ok(nicoVideos.length > 0, "Should find video with Nico");
});

test("findVideosForBook finds relevant videos for book titles", () => {
  const travelVideos = findVideosForBook("Der größte Schatz", "de");
  assert.ok(travelVideos.length > 0);
});

test("fetchYouTubeTranscript parses timed subtitle cues for valid video", async () => {
  const cues = await fetchYouTubeTranscript("dC6ZGLzdaTs", "de");
  assert.ok(Array.isArray(cues));
  if (cues.length > 0) {
    assert.ok(cues[0].start >= 0);
    assert.ok(cues[0].end > cues[0].start);
    assert.ok(cues[0].text.length > 0);
  }
});

test("normalizes overlapping YouTube caption durations", () => {
  const cues = normalizeSubtitleCues([
    { start: 11.799, end: 15.599, duration: 3.8, text: "Es ist 9:30 Uhr." },
    { start: 13.32, end: 18.56, duration: 5.24, text: "Oh, wir müssen bald zum Gate gehen." },
    { start: 15.599, end: 19.24, duration: 3.641, text: "Ja, lass uns gehen." },
  ]);

  assert.equal(cues[0].end, 13.32);
  assert.equal(cues[1].end, 15.599);
  assert.equal(cues[2].end, 19.24);
});

test("live video metadata is classified from title and description", () => {
  assert.equal(inferVideoLevel("Deutsch A2 Grammatik für Anfänger"), "A2");
  assert.equal(inferVideoCategory("German grammar: cases and articles"), "grammar");
  assert.equal(inferVideoCategory("A short German story for learners"), "stories");
});
