import test from "node:test";
import assert from "node:assert/strict";
import {
  formatAudioDuration,
  parseDurationToSeconds,
  detectExplicitCefr,
  classifyAudiobookCefr,
  isLikelyAdvancedText,
  pickBestFitAudiobook,
  fetchAudiobooks,
  AUDIOBOOK_LANGUAGES,
} from "./audiobooks.ts";
import { isBenignPlaybackAbort, syncAudioSource } from "./playback.ts";
import type { Audiobook } from "../types.ts";

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

test("AUDIOBOOK_LANGUAGES contains correct search queries", () => {
  assert.ok(AUDIOBOOK_LANGUAGES.de.iaQuery.includes("german"));
  assert.ok(AUDIOBOOK_LANGUAGES.en.iaQuery.includes("english"));
  assert.ok(AUDIOBOOK_LANGUAGES.fr.iaQuery.includes("french"));
  assert.ok(AUDIOBOOK_LANGUAGES.ru.iaQuery.includes("russian"));
  assert.equal(AUDIOBOOK_LANGUAGES.all.iaQuery, "");
});

// ─── CEFR classification regression tests ──────────────────────────────────
//
// The bug being fixed: books with an explicit B1/B2/C1/C2 marker were
// sometimes overridden by a genre/author heuristic (or by the requested
// search filter) and downgraded to a false A1. See
// docs/coordination/tasks/claude-audiobooks-home-improvements.md item 1.

test("detectExplicitCefr recovers a labelled level, case-insensitively", () => {
  assert.deepEqual(detectExplicitCefr("Der Prozess (Niveau A1)")?.level, "A1");
  assert.deepEqual(detectExplicitCefr("Level: B2 Graded Reader")?.level, "B2");
  assert.deepEqual(detectExplicitCefr("Stufe b1 — Kurzgeschichten")?.level, "B1");
  assert.deepEqual(detectExplicitCefr("CEFR C1 edition")?.level, "C1");
});

test("detectExplicitCefr recovers a bracketed or dash-separated code", () => {
  assert.deepEqual(detectExplicitCefr("Die Verwandlung [B2]")?.level, "B2");
  assert.deepEqual(detectExplicitCefr("(A2) Kurzgeschichten für Anfänger")?.level, "A2");
  assert.deepEqual(detectExplicitCefr("Der Prozess – B2")?.level, "B2");
});

test("detectExplicitCefr combines 'Graded Reader' with a nearby code", () => {
  assert.deepEqual(detectExplicitCefr("Graded Reader A2: Kurzgeschichten")?.level, "A2");
});

test("detectExplicitCefr finds nothing in ordinary prose", () => {
  assert.equal(detectExplicitCefr("Grimms Märchen, gelesen von LibriVox"), null);
  assert.equal(detectExplicitCefr("Also sprach Zarathustra von Friedrich Nietzsche"), null);
});

test("an explicit B1 marker is never downgraded to A1 by a genre/author heuristic", () => {
  // Same title a naive keyword scan would call "children's fairy tale → A1",
  // but the source itself states B1 — the explicit marker must win.
  const result = classifyAudiobookCefr("Grimms Märchen für Kinder (Niveau B1)", "Adaptierte Ausgabe");
  assert.equal(result.level, "B1");
  assert.equal(result.confidence, "verified");
});

test("an explicit A1 marker is kept as A1", () => {
  const result = classifyAudiobookCefr("Der Weg (Niveau A1)", "Leichte Lektüre für Anfänger");
  assert.equal(result.level, "A1");
  assert.equal(result.confidence, "verified");
});

test("an original, unadapted Grimm collection is never guessed as A1", () => {
  // The exact false positive that shipped: genre + author keywords ("märchen",
  // "grimm", "kinder") used to force A1 with no adaptation actually present.
  const result = classifyAudiobookCefr("Kinder- und Hausmärchen der Brüder Grimm", "Gesammelt von Jacob und Wilhelm Grimm");
  assert.notEqual(result.level, "A1");
  assert.equal(result.confidence, "unverified");
  assert.equal(result.level, null);
});

test("an original Kafka novella is never guessed as A1 either", () => {
  const result = classifyAudiobookCefr("Die Verwandlung", "Eine Erzählung von Franz Kafka");
  assert.notEqual(result.level, "A1");
  assert.notEqual(result.confidence, "verified");
});

test("classic philosophy without a marker is an approximate C1/C2 guess, not a confirmed fact", () => {
  const zarathustra = classifyAudiobookCefr("Also sprach Zarathustra", "Ein Buch für Alle und Keinen von Friedrich Nietzsche");
  assert.equal(zarathustra.level, "C2");
  assert.equal(zarathustra.confidence, "approximate");

  const schiller = classifyAudiobookCefr("Die Räuber", "Ein Schauspiel von Friedrich Schiller");
  assert.equal(schiller.level, "C1");
  assert.equal(schiller.confidence, "approximate");
});

test("adventure/novella authors give an approximate B1/B2, never verified", () => {
  const zweig = classifyAudiobookCefr("Schachnovelle", "Eine Erzählung von Stefan Zweig");
  assert.equal(zweig.level, "B1");
  assert.equal(zweig.confidence, "approximate");

  const fontane = classifyAudiobookCefr("Effi Briest", "Roman von Theodor Fontane");
  assert.equal(fontane.level, "B2");
  assert.equal(fontane.confidence, "approximate");
});

test("'Leichtes Deutsch' without a numeric code is an approximate A2, not verified", () => {
  const result = classifyAudiobookCefr("Der Marktplatz", "Ein Hörbuch in Leichtes Deutsch");
  assert.equal(result.level, "A2");
  assert.equal(result.confidence, "approximate");
});

test("text with no adaptation and no matching keyword is unverified, not defaulted to B1", () => {
  // The old heuristic's catch-all `return "B1"` was itself a false-confidence
  // guess — an unrecognised original should report "unknown", not a level.
  const result = classifyAudiobookCefr("Reisebericht aus Island", "Ein Tagebuch");
  assert.equal(result.level, null);
  assert.equal(result.confidence, "unverified");
});

test("an author-name keyword never fires from inside an unrelated compound surname", () => {
  // Found live: E.T.A. Hoffmann was classified "≈ B2 (mann)" because "mann"
  // is a substring of "Hoffmann" — an extremely common German surname
  // suffix, not evidence of Thomas Mann. Same shape of bug for Hesse/Hessen.
  const hoffmann = classifyAudiobookCefr("Klein Zaches, genannt Zinnober", "Ein Märchen von E. T. A. Hoffmann");
  assert.notEqual(hoffmann.confidence, "verified");
  if (hoffmann.confidence === "approximate") assert.notEqual(hoffmann.level, "B2");

  const hessen = classifyAudiobookCefr("Sagen aus Hessen", "Volkssagen aus dem Bundesland Hessen");
  if (hessen.confidence === "approximate") assert.notEqual(hessen.level, "B2");
});

test("a real Thomas Mann title still gets the approximate B2 signal", () => {
  const result = classifyAudiobookCefr("Der Zauberberg", "Ein Roman von Thomas Mann");
  assert.equal(result.confidence, "approximate");
  assert.equal(result.level, "B2");
});

test("isLikelyAdvancedText flags philosophy/classics authors, not children's genre words", () => {
  assert.equal(isLikelyAdvancedText("Also sprach Zarathustra", "Friedrich Nietzsche"), true);
  assert.equal(isLikelyAdvancedText("Faust"), true);
  assert.equal(isLikelyAdvancedText("Grimms Märchen", "Brüder Grimm"), false);
  assert.equal(isLikelyAdvancedText("Der kleine Prinz"), false);
});

function book(overrides: Partial<Audiobook>): Audiobook {
  return {
    id: overrides.id ?? "id",
    title: overrides.title ?? "Title",
    author: overrides.author ?? "Author",
    language: "de",
    sourceType: "librivox",
    ...overrides,
  };
}

test("pickBestFitAudiobook prefers a verified match over an approximate one", () => {
  const books = [
    book({ id: "approx", cefrLevel: "B1", cefrConfidence: "approximate", downloads: 999 }),
    book({ id: "verified", cefrLevel: "B1", cefrConfidence: "verified", downloads: 1 }),
    book({ id: "other-level", cefrLevel: "C1", cefrConfidence: "verified" }),
  ];
  const match = pickBestFitAudiobook(books, "B1");
  assert.equal(match?.id, "verified");
});

test("pickBestFitAudiobook falls back to the most-downloaded approximate match", () => {
  const books = [
    book({ id: "low", cefrLevel: "B2", cefrConfidence: "approximate", downloads: 5 }),
    book({ id: "high", cefrLevel: "B2", cefrConfidence: "approximate", downloads: 50 }),
  ];
  const match = pickBestFitAudiobook(books, "B2");
  assert.equal(match?.id, "high");
});

test("pickBestFitAudiobook returns nothing rather than a wrong-level or unverified guess", () => {
  const books = [
    book({ id: "unverified", cefrLevel: null, cefrConfidence: "unverified" }),
    book({ id: "wrong-level", cefrLevel: "C2", cefrConfidence: "verified" }),
  ];
  assert.equal(pickBestFitAudiobook(books, "A1"), null);
});

// ─── fetchAudiobooks: a level filter must not display a mismatched result ──
//
// Live-observed follow-up to the classification fix: selecting "A1" in the
// catalog kept showing books this classifier honestly rated "≈ B1", because
// the underlying Internet Archive query is only a loose keyword search
// (fairy tale / adventure / classic), not a real level filter. The badge was
// no longer lying, but the filter still was.

function iaResponse(docs: Record<string, unknown>[], numFound = docs.length) {
  return { response: { docs, numFound } };
}

function withFakeFetch(handler: (url: string) => unknown, run: () => Promise<void>): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const body = handler(String(url));
    return { ok: true, status: 200, statusText: "OK", json: async () => body } as Response;
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

test("a level filter keeps only results that actually classify at that level", async () => {
  const docs = [
    { identifier: "verified-a1", title: "Der Weg (Niveau A1)", creator: "Lehrbuch", language: "german" },
    { identifier: "approx-b1", title: "Grimms Märchen", creator: "Brüder Grimm", subject: "erzählung", language: "german" },
    { identifier: "unverified", title: "Ein Tagebuch", creator: "Unbekannt", language: "german" },
  ];

  await withFakeFetch(
    () => iaResponse(docs, docs.length),
    async () => {
      const result = await fetchAudiobooks({ language: "de", cefrLevel: "A1", page: 1, pageSize: 10 });
      assert.equal(result.audiobooks.length, 1);
      assert.equal(result.audiobooks[0].id, "verified-a1");
      assert.equal(result.matchedOnPage, 1);
      // The raw search hit count is preserved for pager navigation, but is
      // never presented as "N books at this level" — see DiscoverView.
      assert.equal(result.total, 3);
    },
  );
});

test("no filter means no post-filtering — every classified result is returned", async () => {
  const docs = [
    { identifier: "one", title: "Grimms Märchen", subject: "erzählung", language: "german" },
    { identifier: "two", title: "Also sprach Zarathustra", creator: "Nietzsche", language: "german" },
  ];

  await withFakeFetch(
    () => iaResponse(docs, docs.length),
    async () => {
      const result = await fetchAudiobooks({ language: "de", cefrLevel: "all", page: 1, pageSize: 10 });
      assert.equal(result.audiobooks.length, 2);
      assert.equal(result.matchedOnPage, undefined);
    },
  );
});

test("a level filter requests a larger raw batch, so filtering has real candidates to work with", async () => {
  let requestedRows = null;
  await withFakeFetch(
    (url) => {
      requestedRows = new URL(url).searchParams.get("rows");
      return iaResponse([]);
    },
    async () => {
      await fetchAudiobooks({ language: "de", cefrLevel: "B1", page: 1, pageSize: 18 });
    },
  );
  assert.equal(requestedRows, "108"); // 18 * 6, under the 120 cap
});

// ─── Playback: pause fix + background/lock-screen resilience ──────────────

test("pausing keeps currentTime because the active source is not reloaded", () => {
  const audio = {
    src: "chapter-1.mp3",
    currentTime: 37.5,
    playbackRate: 1,
    loadCalls: 0,
    load(this: { loadCalls: number; currentTime: number }) {
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
    load(this: { loadCalls: number; currentTime: number }) {
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

test("isBenignPlaybackAbort recognises the two routine play() rejections", () => {
  assert.equal(isBenignPlaybackAbort(new DOMException("interrupted", "AbortError")), true);
  assert.equal(isBenignPlaybackAbort(new DOMException("blocked", "NotAllowedError")), true);
});

test("isBenignPlaybackAbort does not swallow a real playback failure", () => {
  assert.equal(isBenignPlaybackAbort(new DOMException("decode failed", "NotSupportedError")), false);
  assert.equal(isBenignPlaybackAbort(new Error("network error")), false);
  assert.equal(isBenignPlaybackAbort("not even an error"), false);
});
