import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { parseDictionaryEntries, buildDictionaryFromImagePrompt } from "./buildDictionaryPrompt.ts";
import { startFakeGeminiServer, type FakeGeminiServer } from "./fakeGeminiServer.ts";

// A page like the coursebook "Ihr Wortschatz" spread: nouns with plural
// markers, verbs, adjectives, function words.
const PAGE_ANSWER = {
  pageKind: "список слов из учебника",
  isVocabularyList: true,
  entries: [
    {
      headword: "der Ball", lemma: "Ball", translation: "мяч", partOfSpeech: "существительное",
      gender: "m", article: "der", plural: "die Bälle", forms: {}, cefr: "A1",
      note: "", example: "Der Ball ist rot.", exampleTranslation: "Мяч красный.",
    },
    {
      headword: "die Kosten", lemma: "Kosten", translation: "расходы", partOfSpeech: "существительное",
      gender: "pl", article: "die", plural: "только мн. ч.", forms: {}, cefr: "B1",
      note: "Употребляется только во множественном числе.", example: "Die Kosten sind hoch.",
      exampleTranslation: "Расходы высокие.",
    },
    {
      headword: "einladen", lemma: "einladen", translation: "приглашать", partOfSpeech: "глагол",
      gender: "", article: "", plural: "",
      forms: { praeteritum: "lud ein", partizip2: "eingeladen", hilfsverb: "haben", trennbar: "да" },
      cefr: "A2", note: "", example: "Ich lade dich ein.", exampleTranslation: "Я тебя приглашаю.",
    },
  ],
};

describe("reading a vocabulary page into entries", () => {
  test("the prompt demands every printed word, and forbids inventing any", () => {
    const prompt = buildDictionaryFromImagePrompt({ targetLanguage: "German", nativeLanguage: "Russian" });
    assert.match(prompt, /EVERY word printed on the page/);
    assert.match(prompt, /Never invent vocabulary that is not on\s+the page/);
    assert.match(prompt, /do not skip words you consider easy/);
    // The shorthand on the page ("der Ball, ¨e") is exactly what a learner
    // cannot read yet, so it must come back expanded.
    assert.match(prompt, /Expand the page's shorthand markers into the real form/);
    assert.match(prompt, /"cefr"/);
  });

  test("entries survive with their grammar intact", () => {
    const { entries, isVocabularyList } = parseDictionaryEntries(PAGE_ANSWER);
    assert.equal(entries.length, 3);
    assert.equal(isVocabularyList, true);

    const ball = entries[0];
    assert.equal(ball.article, "der");
    assert.equal(ball.gender, "m");
    assert.equal(ball.plural, "die Bälle", "the plural marker is expanded, not copied as '¨e'");
    assert.equal(ball.cefr, "A1");

    const einladen = entries[2];
    assert.equal(einladen.forms?.partizip2, "eingeladen");
    assert.equal(einladen.forms?.trennbar, "да");
  });

  test("the same word twice becomes one entry", () => {
    const { entries } = parseDictionaryEntries({
      entries: [
        { headword: "der Ball", lemma: "Ball", translation: "мяч", cefr: "A1" },
        { headword: "Ball", lemma: "ball", translation: "мяч (повтор)", cefr: "A1" },
      ],
    });
    assert.equal(entries.length, 1);
  });

  test("a missing lemma is recovered from the headword", () => {
    const { entries } = parseDictionaryEntries({
      entries: [{ headword: "die Wanderung", translation: "поход", cefr: "B1" }],
    });
    assert.equal(entries[0].lemma, "Wanderung");
  });

  test("junk is dropped rather than stored", () => {
    const { entries } = parseDictionaryEntries({
      entries: [
        { headword: "", lemma: "", translation: "пусто" },
        null,
        "not an object",
        { headword: "gut", lemma: "gut", translation: "хороший", cefr: "НЕВЕРНО", gender: "x" },
      ],
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].cefr, "", "an invalid CEFR value is dropped, not stored as-is");
    assert.equal(entries[0].gender, "", "an invalid gender is dropped");
  });

  test("an answer with no entries yields none, not a guess", () => {
    assert.deepEqual(parseDictionaryEntries({}).entries, []);
    assert.deepEqual(parseDictionaryEntries(null).entries, []);
  });
});

describe("the dictionary call against a stand-in Gemini", () => {
  let server: FakeGeminiServer;
  let runDictionaryPrompt: typeof import("./lessonModel.ts").runDictionaryPrompt;

  before(async () => {
    server = await startFakeGeminiServer();
    process.env.GEMINI_API_BASE_URL = server.baseUrl;
    ({ runDictionaryPrompt } = await import(`./lessonModel.ts?dict=${Date.now()}`));
  });

  after(async () => {
    delete process.env.GEMINI_API_BASE_URL;
    await server.close();
  });

  test("a full page of words comes back, with the budget spent on the answer", async () => {
    server.queue({ kind: "json", value: PAGE_ANSWER });
    const result = await runDictionaryPrompt("k", "read the words", "aGVsbG8=", "image/jpeg");

    assert.ok(result.ok, `expected success, got: ${!result.ok && result.error}`);
    assert.equal(parseDictionaryEntries(result.data).entries.length, 3);

    const config = (server.requests.at(-1)!.body as { generationConfig?: Record<string, unknown> }).generationConfig ?? {};
    assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 });
    assert.ok((config.maxOutputTokens as number) >= 16384, "forty entries is a long answer");
    assert.ok(config.responseSchema);
  });

  test("a page cut off halfway keeps the words that did arrive", async () => {
    const full = JSON.stringify(PAGE_ANSWER);
    server.queue({ kind: "truncated", value: PAGE_ANSWER, keep: full.indexOf("einladen") });

    const result = await runDictionaryPrompt("k", "read the words", "aGVsbG8=", "image/jpeg");
    assert.ok(result.ok);
    assert.equal(result.truncated, true, "so the learner can be told to photograph the rest");
    assert.ok(parseDictionaryEntries(result.data).entries.length >= 2);
  });
});
