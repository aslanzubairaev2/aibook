import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { buildDiscussSystemPrompt, parseDiscussReply, INITIAL_DISCUSS_REQUEST } from "./buildDiscussPrompt.ts";
import { describeCardFamiliarity, describeTextFamiliarity } from "./wordProfile.ts";
import type { DiscussWordProfile, Flashcard } from "../types.ts";

const BASE = {
  mode: "word" as const,
  selectedText: "aufräumen",
  sentence: "Ich räume mein Zimmer auf.",
  nativeLanguage: "ru",
  targetLanguage: "de",
};

function card(overrides: Partial<Flashcard> = {}): Flashcard {
  return {
    id: "1",
    type: "word",
    front: "aufräumen",
    back: "убирать",
    source: "test",
    addedAt: new Date().toISOString(),
    status: "review",
    repetitions: 3,
    lapses: 0,
    intervalDays: 6,
    easeFactor: 2.5,
    dueAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("what the discussion asks the model for", () => {
  test("a word must come back as sentences the learner could say, not as a definition", () => {
    const prompt = buildDiscussSystemPrompt(BASE);
    // The complaint that started this: the answer named a rule instead of
    // showing "я убираю / мне надо убрать / это надо убрать".
    assert.match(prompt, /"I <verb> it" in the everyday present/);
    assert.match(prompt, /"I have to \/ I need to <verb> it"/);
    assert.match(prompt, /this needs <verb>ing/);
    assert.match(prompt, /a question with it/);
    assert.match(prompt, /Four to six example sentences/);
  });

  test("grammar terminology is banned as an explanation on its own", () => {
    const prompt = buildDiscussSystemPrompt(BASE);
    assert.match(prompt, /Do NOT explain with grammar terminology/);
    assert.match(prompt, /separable prefix/, "the terms to avoid are named, not left to taste");
    assert.match(prompt, /SHOW the thing with an example first/);
  });

  test("the answer carries follow-up questions and table buttons, not a pasted paradigm", () => {
    const prompt = buildDiscussSystemPrompt(BASE);
    assert.match(prompt, /3 short follow-up questions/);
    assert.match(prompt, /AS THE LEARNER WOULD ASK THEM/);
    assert.match(prompt, /do NOT paste the table into the chat/);
    for (const kind of ["conjugation", "declension", "comparison", "forms"]) {
      assert.ok(prompt.includes(`"${kind}"`), `${kind} is offered as a button kind`);
    }
  });

  test("a noun and a sentence get their own brief", () => {
    assert.match(buildDiscussSystemPrompt(BASE), /For a NOUN: with its article/);
    const sentence = buildDiscussSystemPrompt({ ...BASE, mode: "sentence", sentenceBefore: "A.", sentenceAfter: "B." });
    assert.match(sentence, /the same frame with two or three different fillings/);
    assert.match(sentence, /Previous sentence: "A\."/);
  });

  test("the opening request asks for use, not for a summary", () => {
    assert.match(INITIAL_DISCUSS_REQUEST, /how I would actually use it when speaking/);
  });
});

describe("how well the learner knows this exact word changes the answer", () => {
  const withProfile = (profile: DiscussWordProfile) => buildDiscussSystemPrompt({ ...BASE, wordProfile: profile });

  test("a word that keeps being forgotten gets a memory hook and less material", () => {
    const prompt = withProfile(describeCardFamiliarity(card({ status: "relearning", lapses: 4, easeFactor: 1.8 })));
    assert.match(prompt, /they keep forgetting this exact item/);
    assert.match(prompt, /ONE concrete memory hook/);
    assert.match(prompt, /more material is exactly what has not been working/);
    assert.ok(!prompt.includes("Skip the beginner layer entirely"), "the mastered coaching must not also appear");
  });

  test("a word they already know skips the basics", () => {
    const prompt = withProfile(describeCardFamiliarity(card({ repetitions: 9, intervalDays: 90 })));
    assert.match(prompt, /Skip the beginner layer entirely/);
    assert.match(prompt, /idioms and fixed expressions/);
    assert.ok(!prompt.includes("ONE concrete memory hook"), "no memory hook for a word that is already stuck");
  });

  test("the schedule informs the answer but is never mentioned in it", () => {
    const prompt = withProfile(describeCardFamiliarity(card({ lapses: 3 })));
    assert.match(prompt, /Never mention the deck, the schedule, review counts/);
  });

  test("with no card and no level, the tutor is told to assume nothing", () => {
    const prompt = buildDiscussSystemPrompt(BASE);
    assert.match(prompt, /not in their deck yet, so assume nothing/);
    assert.match(prompt, /Their overall level is unknown/);
  });

  test("the level estimate is passed through when there is one", () => {
    const prompt = buildDiscussSystemPrompt({ ...BASE, learnerLevel: "Estimated level B1 (CEFR), has 640 cards." });
    assert.match(prompt, /Estimated level B1 \(CEFR\)/);
  });
});

describe("reading the learner's own schedule", () => {
  test("repeated failures outrank a comfortable-looking status", () => {
    assert.equal(describeCardFamiliarity(card({ status: "review", lapses: 3 })).familiarity, "struggling");
    assert.equal(describeCardFamiliarity(card({ status: "relearning" })).familiarity, "struggling");
    assert.equal(describeCardFamiliarity(card({ lapses: 2, easeFactor: 2.0 })).familiarity, "struggling");
  });

  test("a long, clean interval is mastery; a fresh card is not", () => {
    assert.equal(describeCardFamiliarity(card({ repetitions: 6, intervalDays: 45 })).familiarity, "mastered");
    assert.equal(describeCardFamiliarity(card({ status: "new", repetitions: 0 })).familiarity, "new");
    assert.equal(describeCardFamiliarity(card({ status: "learning", repetitions: 1, intervalDays: 1 })).familiarity, "learning");
    assert.equal(describeCardFamiliarity(card({ repetitions: 2, intervalDays: 6 })).familiarity, "familiar");
  });

  test("nothing is claimed about a word the learner has never saved", () => {
    assert.deepEqual(describeCardFamiliarity(null), { familiarity: "unseen" });
    assert.equal(describeTextFamiliarity("aufräumen", []).familiarity, "unseen");
    // The reader matches by text, the way the duplicate check does.
    assert.equal(describeTextFamiliarity("Aufräumen ", [card()]).familiarity, "familiar");
  });
});

describe("reading the model's answer back", () => {
  test("target-language parts stay tappable only when they carry a translation", () => {
    const message = parseDiscussReply(
      {
        contentParts: [
          { type: "text", text: "Убирать — привести в порядок." },
          { type: "learning", text: "Ich räume auf.", translation: "Я убираю." },
          { type: "learning", text: "Ich muss aufräumen." },
          { type: "text", text: "   " },
        ],
      },
      "",
    );
    assert.equal(message.contentParts?.length, 3, "the blank part is dropped");
    assert.deepEqual(message.contentParts?.[1], { type: "learning", text: "Ich räume auf.", translation: "Я убираю." });
    assert.equal(message.contentParts?.[2].type, "text", "an untranslated example is not a learning box");
  });

  test("suggestions are trimmed to a chip-sized handful", () => {
    const message = parseDiscussReply(
      {
        contentParts: [{ type: "text", text: "ok" }],
        suggestions: ["а как сказать «мне надо убрать»?", "", "x".repeat(80), "чем отличается от wegräumen?"],
      },
      "",
    );
    assert.deepEqual(message.suggestions, ["а как сказать «мне надо убрать»?", "чем отличается от wegräumen?"]);
  });

  test("only buttons the app can actually open survive", () => {
    const message = parseDiscussReply(
      {
        contentParts: [{ type: "text", text: "ok" }],
        actions: [
          { kind: "conjugation", label: "Спряжение aufräumen", word: "aufräumen" },
          { kind: "teleport", label: "??", word: "aufräumen" },
          { kind: "declension", label: "Склонение", word: "" },
          { kind: "word", label: "", word: "wegräumen" },
        ],
      },
      "",
    );
    assert.deepEqual(message.actions, [
      { kind: "conjugation", label: "Спряжение aufräumen", word: "aufräumen" },
      { kind: "word", label: "wegräumen", word: "wegräumen" },
    ]);
  });

  test("an unusable answer falls back to whatever text came through", () => {
    const message = parseDiscussReply(null, "Модель ответила прозой.");
    assert.deepEqual(message.contentParts, [{ type: "text", text: "Модель ответила прозой." }]);
    assert.equal(message.suggestions, undefined);

    const empty = parseDiscussReply({ contentParts: [] }, "");
    assert.match(empty.contentParts?.[0].text ?? "", /Спросите ещё раз/);
  });
});
