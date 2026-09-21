import assert from "node:assert/strict";
import test from "node:test";
import { buildVerbPhraseTutorPrompt } from "./buildVerbPhraseTutorPrompt";

const base = {
  action: "answer" as const,
  lemma: "aufräumen",
  headword: "aufräumen",
  translation: "убирать",
  targetLanguage: "de",
  nativeLanguage: "ru",
  challenge: { nativePrompt: "Мне нужно убрать комнату." },
  history: [{ role: "model" as const, text: "Попробуй сказать это по-немецки." }],
};

test("phrase tutor prompt includes the learner's current attempt", () => {
  const prompt = buildVerbPhraseTutorPrompt({ ...base, message: "Ich muss mein Zimmer aufräumen." });

  assert.match(prompt, /ТЕКУЩЕЕ СООБЩЕНИЕ УЧЕНИКА/);
  assert.match(prompt, /Ich muss mein Zimmer aufräumen\./);
  assert.match(prompt, /не по буквальному совпадению/);
});

test("phrase tutor prompt asks for patient retry guidance", () => {
  const prompt = buildVerbPhraseTutorPrompt({ ...base, action: "hint", message: "Дай небольшую подсказку" });

  assert.match(prompt, /не выдавай готовое предложение целиком/);
  assert.match(prompt, /Пунктуация, регистр буквы/);
  assert.match(prompt, /status «accepted»/);
});

test("phrase tutor prompt does not offer a ready answer as a button", () => {
  const prompt = buildVerbPhraseTutorPrompt({ ...base, action: "start" });

  assert.match(prompt, /Поле reply оставь пустым/);
  assert.match(prompt, /Никогда не возвращай там готовую фразу/);
  assert.match(prompt, /без приветствий, похвалы/);
});
