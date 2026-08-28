import test from "node:test";
import assert from "node:assert/strict";
import {
  findActiveSegmentIndex,
  findActiveWordIndex,
  normalizeSegments,
  getLocalTranscriptKey,
} from "./transcribe.ts";
import type { AudiobookSegment } from "@/lib/types";

test("findActiveSegmentIndex returns exact matching segment index", () => {
  const segments: AudiobookSegment[] = [
    { id: "1", start: 0.0, end: 3.5, text: "Es war einmal ein alter König." },
    { id: "2", start: 3.6, end: 7.2, text: "Er lebte in einem großen Schloss." },
    { id: "3", start: 7.5, end: 12.0, text: "Und er hatte drei schöne Töchter." },
  ];

  assert.equal(findActiveSegmentIndex(segments, 0.0), 0);
  assert.equal(findActiveSegmentIndex(segments, 2.0), 0);
  assert.equal(findActiveSegmentIndex(segments, 3.5), 0);
  assert.equal(findActiveSegmentIndex(segments, 5.0), 1);
  assert.equal(findActiveSegmentIndex(segments, 10.0), 2);
});

test("findActiveSegmentIndex handles pauses between segments gracefully", () => {
  const segments: AudiobookSegment[] = [
    { id: "1", start: 1.0, end: 3.0, text: "First sentence." },
    { id: "2", start: 5.0, end: 8.0, text: "Second sentence." },
  ];

  // In between 3.0 and 5.0, should stay on segment 0 (last spoken)
  assert.equal(findActiveSegmentIndex(segments, 4.0), 0);
  // Before first segment, returns -1
  assert.equal(findActiveSegmentIndex(segments, 0.5), -1);
  // After last segment, returns 1
  assert.equal(findActiveSegmentIndex(segments, 10.0), 1);
});

test("findActiveWordIndex locates active word by timestamp", () => {
  const words = [
    { word: "Es", start: 0.0, end: 0.3 },
    { word: "war", start: 0.35, end: 0.7 },
    { word: "einmal", start: 0.75, end: 1.5 },
  ];

  assert.equal(findActiveWordIndex(words, 0.2), 0);
  assert.equal(findActiveWordIndex(words, 0.5), 1);
  assert.equal(findActiveWordIndex(words, 1.0), 2);
  assert.equal(findActiveWordIndex(words, 2.0), -1);
});

test("normalizeSegments cleans and sorts malformed AI response data", () => {
  const raw = [
    { text: " Zweiter Satz. ", start: "5.5", end: "9.0" },
    { text: "Erster Satz.", start: 0, end: 4 },
    { text: "", start: 10, end: 12 }, // empty text should be skipped
    null,
    { text: "Dritter Satz.", start: 10, end: 8 }, // end < start should be fixed
  ];

  const result = normalizeSegments(raw);

  assert.equal(result.length, 3);
  assert.equal(result[0].text, "Erster Satz.");
  assert.equal(result[0].start, 0);
  assert.equal(result[1].text, "Zweiter Satz.");
  assert.equal(result[1].start, 5.5);
  assert.equal(result[2].text, "Dritter Satz.");
  assert.ok(result[2].end > result[2].start);
});

test("getLocalTranscriptKey builds unique key per book and chapter", () => {
  const key = getLocalTranscriptKey("faust_part1_librivox", 3);
  assert.equal(key, "aibook_audiobook_transcript_faust_part1_librivox_ch3");
});
