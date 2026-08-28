import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAudioDuration,
  parseDurationToSeconds,
  estimateAudiobookCefr,
  AUDIOBOOK_LANGUAGES,
} from "./audiobooks.ts";
import { syncAudioSource } from "./playback.ts";

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

test("estimateAudiobookCefr detects levels from keywords", () => {
  // A1: Children, Grimm, Märchen
  assert.equal(
    estimateAudiobookCefr("Grimms Märchen", "Kinder- und Hausmärchen"),
    "A1"
  );
  assert.equal(
    estimateAudiobookCefr("Fairy Tales", "Classic stories for children"),
    "A1"
  );

  // A2: Andersen, Fables, Kurzgeschichten
  assert.equal(
    estimateAudiobookCefr("Kurzgeschichten und Fabeln", "Erzählungen von Bechstein"),
    "A2"
  );

  // B1: Adventure, Novelle, Zweig, Kafka
  assert.equal(
    estimateAudiobookCefr("Schachnovelle", "Eine Erzählung von Stefan Zweig"),
    "B1"
  );

  // B2: Mann, Hesse, Fontane
  assert.equal(
    estimateAudiobookCefr("Effi Briest", "Roman von Theodor Fontane"),
    "B2"
  );

  // C1: Philosophy, Schiller, Goethe
  assert.equal(
    estimateAudiobookCefr("Die Räuber", "Ein Schauspiel von Friedrich Schiller"),
    "C1"
  );

  // C2: Zarathustra, Faust, Kant
  assert.equal(
    estimateAudiobookCefr("Also sprach Zarathustra", "Ein Buch für Alle und Keinen von Friedrich Nietzsche"),
    "C2"
  );
});

test("AUDIOBOOK_LANGUAGES contains correct search queries", () => {
  assert.ok(AUDIOBOOK_LANGUAGES.de.iaQuery.includes("german"));
  assert.ok(AUDIOBOOK_LANGUAGES.en.iaQuery.includes("english"));
  assert.ok(AUDIOBOOK_LANGUAGES.fr.iaQuery.includes("french"));
  assert.ok(AUDIOBOOK_LANGUAGES.ru.iaQuery.includes("russian"));
  assert.equal(AUDIOBOOK_LANGUAGES.all.iaQuery, "");
});

test("pausing keeps currentTime because the active source is not reloaded", () => {
  const audio = {
    src: "chapter-1.mp3",
    currentTime: 37.5,
    playbackRate: 1,
    loadCalls: 0,
    load() {
      this.loadCalls += 1;
      this.currentTime = 0;
    },
  } as unknown as HTMLAudioElement & { loadCalls: number };

  const sourceChanged = syncAudioSource(audio, "chapter-1.mp3", 1, "chapter-1.mp3");

  assert.equal(sourceChanged, false);
  assert.equal(audio.loadCalls, 0);
  assert.equal(audio.currentTime, 37.5);
});

test("changing chapter reloads the source and starts from its beginning", () => {
  const audio = {
    src: "chapter-1.mp3",
    currentTime: 37.5,
    playbackRate: 1,
    loadCalls: 0,
    load() {
      this.loadCalls += 1;
      this.currentTime = 0;
    },
  } as unknown as HTMLAudioElement & { loadCalls: number };

  const sourceChanged = syncAudioSource(audio, "chapter-2.mp3", 1.25, "chapter-1.mp3");

  assert.equal(sourceChanged, true);
  assert.equal(audio.src, "chapter-2.mp3");
  assert.equal(audio.playbackRate, 1.25);
  assert.equal(audio.loadCalls, 1);
  assert.equal(audio.currentTime, 0);
});
