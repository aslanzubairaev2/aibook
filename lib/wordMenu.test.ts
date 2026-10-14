import { test } from "node:test";
import assert from "node:assert/strict";
import { findPhraseCard, findWordCard, isPhrase, sentenceAround } from "./wordMenu.ts";
import type { Flashcard } from "./types.ts";

const card = (id: string, front: string) => ({ id, front, back: "", type: "word" }) as Flashcard;
const deck = [
  card("drucker", "der Drucker"),
  card("oeffnen", "öffnen"),
  card("anschliessen", "den Drucker anschließen"),
  card("formular", "das Formular ausfüllen"),
];

test("a word finds its card exactly, or by dropping the article", () => {
  assert.equal(findWordCard("öffnen", deck)?.id, "oeffnen");
  assert.equal(findWordCard("Öffnen,", deck)?.id, "oeffnen");
  assert.equal(findWordCard("Drucker", deck)?.id, "drucker");
  assert.equal(findWordCard("der Drucker", deck)?.id, "drucker");
  assert.equal(findWordCard("prüfen", deck), null);
});

test("a word inside a phrase finds the phrase card that holds it", () => {
  assert.equal(findPhraseCard("Kannst du bitte den Drucker anschließen?", "Drucker", deck)?.id, "anschliessen");
  assert.equal(findPhraseCard("den Drucker anschließen", null, deck)?.id, "anschliessen");
  // The phrase card must contain the word that was clicked.
  assert.equal(findPhraseCard("Kannst du bitte den Drucker anschließen?", "bitte", deck), null);
});

test("only more than one word is a phrase", () => {
  assert.equal(isPhrase("öffnen"), false);
  assert.equal(isPhrase("der Drucker"), false);
  assert.equal(isPhrase("den Drucker anschließen"), true);
  assert.equal(isPhrase(""), false);
});

test("the phrase shown for a reader paragraph is the sentence with the word", () => {
  const para = "Ich gehe ins Büro. Dort muss ich den Drucker anschließen. Dann trinke ich Kaffee.";
  assert.equal(sentenceAround(para, "Drucker"), "Dort muss ich den Drucker anschließen.");
});
