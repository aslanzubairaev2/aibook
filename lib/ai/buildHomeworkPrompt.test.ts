import assert from "node:assert/strict";
import test from "node:test";
import { buildHomeworkExtractPrompt, parseExercise } from "./buildHomeworkPrompt.ts";
import { computeHomeworkProgress } from "../../components/homework/homeworkAnswers.ts";

test("word formation is not misrouted to the conjugation modal", () => {
  const exercise = parseExercise({
    number: 14,
    instruction: "Образуйте от глаголов существительные, обозначающие лица, переведите их на русский язык.",
    widget: "conjugation",
    verbs: ["lesen", "arbeiten", "übersetzen", "besuchen"],
  });

  assert.ok(exercise);
  assert.equal(exercise.widget, "formation");
  assert.deepEqual(exercise.items?.map((item) => item.text), ["lesen", "arbeiten", "übersetzen", "besuchen"]);
  assert.deepEqual(exercise.fields, [
    { key: "word", label: "Существительное" },
    { key: "translation", label: "Перевод" },
  ]);
});

test("a real conjugation instruction keeps the conjugation widget", () => {
  const exercise = parseExercise({
    number: 3,
    instruction: "Проспрягайте глаголы в Präsens.",
    widget: "conjugation",
    verbs: ["lesen"],
  });

  assert.ok(exercise);
  assert.equal(exercise.widget, "conjugation");
  assert.deepEqual(exercise.verbs, ["lesen"]);
});

test("formation fields can be supplied per item and are preserved", () => {
  const exercise = parseExercise({
    number: 8,
    instruction: "Образуйте формы.",
    widget: "formation",
    fields: [{ key: "word", label: "Слово" }],
    items: [{
      number: 1,
      text: "arbeiten",
      fields: [
        { key: "word", label: "Существительное" },
        { key: "feminine", label: "Женская форма" },
      ],
    }],
  });

  assert.ok(exercise);
  assert.deepEqual(exercise.items?.[0].fields, [
    { key: "word", label: "Существительное" },
    { key: "feminine", label: "Женская форма" },
  ]);
  assert.deepEqual(exercise.fields, [{ key: "word", label: "Слово" }]);
});

test("the extraction prompt tells the model what a formation exercise needs", () => {
  const prompt = buildHomeworkExtractPrompt();
  assert.match(prompt, /"formation"/u);
  assert.match(prompt, /Do not route a word-formation task to "conjugation"/u);
  assert.match(prompt, /Существительное/gu);
});

test("formation progress counts every AI-described response field", () => {
  const exercise = parseExercise({
    number: 14,
    instruction: "Образуйте от глаголов существительные, обозначающие лица, переведите их на русский язык.",
    widget: "formation",
    items: [
      { number: 1, text: "lesen" },
      { number: 2, text: "arbeiten" },
    ],
  });

  assert.ok(exercise);
  assert.equal(computeHomeworkProgress([exercise], {
    items: { "14:1": ["der Leser", "читатель"] },
    conjugations: {},
  }), 50);
});

test("missing blank metadata is inferred from internal markers", () => {
  const exercise = parseExercise({
    number: 6,
    instruction: "Ergänzen Sie die passenden Personalpronomen.",
    widget: "open",
    items: [{ number: 1, text: "Schenkt (2) {{0}} doch ein Hörbuch! Das gefällt {{1}} sicher." }],
  });

  assert.ok(exercise);
  assert.equal(exercise.widget, "cloze");
  assert.deepEqual(exercise.items?.[0].blanks, [{ select: false }, { select: false }]);
});

test("self-writing exercises get a usable response field", () => {
  const exercise = parseExercise({
    number: 11,
    instruction: "Ihr Text – Ergänzen Sie für sich selbst. Schreiben Sie den Text ins Heft.",
    widget: "text",
  });

  assert.ok(exercise);
  assert.equal(exercise.widget, "open");
  assert.deepEqual(exercise.items, undefined);
});

test("picture sorting keeps categories and the selected vocabulary bank", () => {
  const exercise = parseExercise({
    number: 7,
    instruction: "Ordnen Sie die Nomen aus Ihrem Wortschatz zu.",
    widget: "sort",
    categories: ["Feste", "Jahreszeiten", "Monate"],
    bank: ["der Frühling", "Januar"],
  });

  assert.ok(exercise);
  assert.equal(exercise.widget, "sort");
  assert.deepEqual(exercise.categories, ["Feste", "Jahreszeiten", "Monate"]);
  assert.equal(computeHomeworkProgress([exercise], { items: { "7:1": "Januar" }, conjugations: {} }), 33);
});
