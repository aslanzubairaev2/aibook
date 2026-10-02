// The recording that exposed it: three sentences with pauses, of which Azure's
// short-audio endpoint returned only the first. These tests pin the server
// side of the fix — split at pauses, merge back, flag anything cut short.

import assert from "node:assert/strict";
import test from "node:test";
import { alignReference, mergePhrases, phraseCutShort, sentences, splitOnPauses, type PhraseResult } from "./speechSegments.ts";

const RATE = 16000;

/** «Speech»: a tone with a little wobble; «pause»: near silence with room noise. */
function audio(plan: { speechMs?: number; pauseMs?: number }[]): Int16Array {
  const chunks: number[] = [];
  let t = 0;
  for (const step of plan) {
    const ms = step.speechMs ?? step.pauseMs ?? 0;
    const n = Math.round((ms / 1000) * RATE);
    for (let i = 0; i < n; i++, t++) {
      chunks.push(step.speechMs
        ? Math.round(9000 * Math.sin((2 * Math.PI * 220 * t) / RATE) * (0.7 + 0.3 * Math.sin(t / 900)))
        : Math.round((Math.random() - 0.5) * 60));
    }
  }
  return Int16Array.from(chunks);
}

test("three sentences with 2–4 second pauses become three phrases, none lost", () => {
  const pcm = audio([{ pauseMs: 500 }, { speechMs: 1800 }, { pauseMs: 2000 }, { speechMs: 2600 }, { pauseMs: 3000 }, { speechMs: 2200 }, { pauseMs: 4000 }]);
  const segments = splitOnPauses(pcm);
  assert.equal(segments.length, 3);
  assert.ok(Math.abs(segments[0].voicedStartMs - 500) <= 40);
  assert.ok(Math.abs(segments[2].voicedEndMs - (500 + 1800 + 2000 + 2600 + 3000 + 2200)) <= 40, "the last sentence is covered to its end");
  for (const s of segments) assert.ok(s.startMs <= s.voicedStartMs && s.endMs >= s.voicedEndMs, "padding kept around each phrase");
});

test("short pauses inside a sentence do not split it", () => {
  const pcm = audio([{ speechMs: 700 }, { pauseMs: 300 }, { speechMs: 600 }, { pauseMs: 500 }, { speechMs: 900 }]);
  assert.equal(splitOnPauses(pcm).length, 1);
});

test("a reading text is split into sentences and aligned to what each phrase said", () => {
  const text = "Heute bin ich zu Hause. Ich lese ein Buch und höre Musik. Am Abend koche ich.";
  assert.equal(sentences(text).length, 3);
  const slices = alignReference(text, ["Heute bin ich zu Hause. Ich lese ein Buch und höre Musik.", "Am Abend koche ich."]);
  assert.deepEqual(slices, ["Heute bin ich zu Hause. Ich lese ein Buch und höre Musik.", "Am Abend koche ich."]);
});

const phrase = (startMs: number, words: [string, number, number][], scores: Partial<PhraseResult["scores"]>, ref = 0): PhraseResult => ({
  segment: { startMs, endMs: startMs + 3000, voicedStartMs: startMs + 200, voicedEndMs: startMs + 200 + words.reduce((n, [, , d]) => n + d, 0) },
  transcript: words.map(([w]) => w).join(" "),
  words: words.map(([word, offset, duration]) => ({ word, accuracy: 90, error_type: "None", offset_ms: offset, duration_ms: duration })),
  scores: { pronunciation: null, accuracy: null, fluency: null, completeness: null, prosody: null, ...scores },
  referenceWords: ref,
});

test("merged phrases keep every word in place and weight the scores", () => {
  const a = phrase(0, [["Heute", 200, 400], ["bin", 650, 200], ["ich", 900, 200], ["zu", 1150, 150], ["Hause", 1350, 500]], { pronunciation: 90, accuracy: 90, fluency: 100, completeness: 100 }, 5);
  const b = phrase(10000, [["Ich", 200, 200], ["lese", 450, 300]], { pronunciation: 60, accuracy: 60, fluency: 80, completeness: 50 }, 4);
  const merged = mergePhrases([a, b], true);
  assert.equal(merged.transcript, "Heute bin ich zu Hause Ich lese");
  assert.equal(merged.words.length, 7);
  assert.equal(merged.words[5].offset_ms, 10200, "the second phrase's words move to their place in the recording");
  assert.equal(merged.scores.pronunciation, 81.4, "weighted by words: (90·5 + 60·2) / 7");
  assert.equal(merged.scores.completeness, 77.8, "weighted by reference words: (100·5 + 50·4) / 9");
  assert.equal(merged.scores.prosody, null, "absent stays absent, never zero");
  assert.equal(mergePhrases([a], false).scores.completeness, null);
});

test("pauses between phrases are measured; whole-answer fluency is not invented from within-phrase scores", () => {
  // The real answer: phrases fluent inside (98–100), separated by pauses up to 6.7 s.
  const a = { ...phrase(0, [["Heute", 200, 400]], { fluency: 98 }), confidence: 0.92 };
  const b = { ...phrase(0, [["Sill", 100, 300]], { fluency: 99 }), confidence: 0.66 };
  b.segment = { startMs: 7000, endMs: 9000, voicedStartMs: 7300, voicedEndMs: 8800 };
  const merged = mergePhrases([a, b], false);
  assert.equal(merged.scores.fluency, null, "one number would read a 6-second silence as fluent");
  assert.equal(merged.delivery.phrases, 2);
  assert.equal(merged.delivery.longest_pause_ms, 7300 - a.segment.voicedEndMs);
  assert.equal(merged.delivery.pauses_over_2s, 1);
  assert.ok(merged.delivery.speech_ratio !== null && merged.delivery.speech_ratio < 0.5);
  assert.ok(merged.delivery.fluency_within_phrases !== null && merged.delivery.fluency_within_phrases > 98);
  assert.deepEqual(merged.phrases.map((p) => p.low_confidence), [false, true], "the unsure ending is flagged");
});

test("speech running on after the last recognized word is flagged as cut short", () => {
  const p = phrase(0, [["Heute", 200, 400]], { pronunciation: 90 });
  assert.equal(phraseCutShort(p), false);
  assert.equal(phraseCutShort({ ...p, segment: { ...p.segment, voicedEndMs: 6000 } }), true);
});
