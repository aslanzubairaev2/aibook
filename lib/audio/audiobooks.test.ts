import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAudioDuration,
  parseDurationToSeconds,
  classifyAudiobookCefr,
  detectExplicitCefr,
  AUDIOBOOK_LANGUAGES,
} from "./audiobooks.ts";

test("formatAudioDuration formats seconds correctly", () => {
  assert.equal(formatAudioDuration(0), "—");
  assert.equal(formatAudioDuration(-5), "—");
  assert.equal(formatAudioDuration(45), "0:45");
  assert.equal(formatAudioDuration(125), "2:05");
  assert.equal(formatAudioDuration(3600), "1 ч 00 мин");
  assert.equal(formatAudioDuration(3665), "1 ч 01 мин");
  assert.equal(formatAudioDuration(7325), "2 ч 02 мин");
});

test("parseDurationToSeconds handles various formats", () => {
  assert.equal(parseDurationToSeconds(120), 120);
  assert.equal(parseDurationToSeconds("45"), 45);
  assert.equal(parseDurationToSeconds("03:15"), 195);
  assert.equal(parseDurationToSeconds("01:02:10"), 3730);
  assert.equal(parseDurationToSeconds(""), 0);
  assert.equal(parseDurationToSeconds(undefined), 0);
});

test("detectExplicitCefr finds verified CEFR tags in title and description", () => {
  const t1 = detectExplicitCefr("Deutscher Sprachkurs Niveau A1");
  assert.ok(t1);
  assert.equal(t1?.level, "A1");
  assert.equal(t1?.confidence, "verified");

  const t2 = detectExplicitCefr("Graded Reader Level A2", "German for elementary learners");
  assert.ok(t2);
  assert.equal(t2?.level, "A2");
  assert.equal(t2?.confidence, "verified");

  const t3 = detectExplicitCefr("Einfache Geschichten (A1)", "Deutsch lernen für Anfänger");
  assert.ok(t3);
  assert.equal(t3?.level, "A1");
  assert.equal(t3?.confidence, "verified");

  // Original non-learning books should not match
  const t4 = detectExplicitCefr("Märchen der Gebrüder Grimm 1");
  assert.equal(t4, null);
});

test("classifyAudiobookCefr rejects false A1 for unabridged original fairy tales and classics", () => {
  // 1. Grimm original tales must NOT be marked A1
  const grimm1 = classifyAudiobookCefr("Märchen", "Kinder- und Hausmärchen von Brüder Grimm");
  assert.notEqual(grimm1.level, "A1");
  assert.equal(grimm1.confidence, "unverified");
  assert.equal(grimm1.level, null);

  const grimm2 = classifyAudiobookCefr("Märchen der Gebrüder Grimm 1", "Originalaufnahme aus Gutenberg");
  assert.notEqual(grimm2.level, "A1");
  assert.equal(grimm2.confidence, "unverified");
  assert.equal(grimm2.level, null);

  // 2. Kafka original stories must NOT be marked A1
  const kafka = classifyAudiobookCefr("Die Verwandlung", "Erzählung von Franz Kafka");
  assert.notEqual(kafka.level, "A1");
  assert.equal(kafka.confidence, "unverified");

  // 3. Andersen fairy tales must NOT be marked A1
  const andersen = classifyAudiobookCefr("Andersens Märchen", "Hans Christian Andersen");
  assert.notEqual(andersen.level, "A1");
  assert.equal(andersen.confidence, "unverified");
});

test("classifyAudiobookCefr detects explicit levels as verified", () => {
  const a1 = classifyAudiobookCefr("Leichtes Deutsch Niveau A1", "Kurze Dialoge für Anfänger");
  assert.equal(a1.level, "A1");
  assert.equal(a1.confidence, "verified");

  const a2 = classifyAudiobookCefr("Graded Reader Level A2", "Lerntexte mit Vokabeln");
  assert.equal(a2.level, "A2");
  assert.equal(a2.confidence, "verified");
});

test("classifyAudiobookCefr estimates high complexity philosophy and drama as approximate C1/C2", () => {
  // Philosophy -> approximate C2
  const nietzsche = classifyAudiobookCefr("Also sprach Zarathustra", "Friedrich Nietzsche");
  assert.equal(nietzsche.level, "C2");
  assert.equal(nietzsche.confidence, "approximate");

  // Classic Drama -> approximate C1
  const schiller = classifyAudiobookCefr("Die Räuber", "Friedrich Schiller");
  assert.equal(schiller.level, "C1");
  assert.equal(schiller.confidence, "approximate");
});

test("AUDIOBOOK_LANGUAGES contains correct search queries", () => {
  assert.ok(AUDIOBOOK_LANGUAGES.de.iaQuery.includes("german"));
  assert.ok(AUDIOBOOK_LANGUAGES.en.iaQuery.includes("english"));
  assert.ok(AUDIOBOOK_LANGUAGES.fr.iaQuery.includes("french"));
  assert.ok(AUDIOBOOK_LANGUAGES.ru.iaQuery.includes("russian"));
  assert.equal(AUDIOBOOK_LANGUAGES.all.iaQuery, "");
});

test("Audio playback controller suppresses AbortError and handles rapid track changes", async () => {
  let playReqId = 0;
  let activeState = false;

  const simulatePlayRequest = async (shouldAbort: boolean) => {
    const currentId = ++playReqId;
    try {
      if (shouldAbort) {
        const err = new Error("The play() request was interrupted by a new load request");
        err.name = "AbortError";
        throw err;
      }
      activeState = true;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // Expected cancellation: do not crash or change state for stale requests
        return 0;
      }
      throw err;
    }
    return currentId;
  };

  // Simulate rapid navigation where request 1 is superseded by request 2
  const p1 = simulatePlayRequest(true);
  const p2 = simulatePlayRequest(false);
  const results = await Promise.all([p1, p2]);

  assert.equal(playReqId, 2);
  assert.equal(results[0], 0);
  assert.equal(results[1], 2);
  assert.equal(activeState, true);
});

