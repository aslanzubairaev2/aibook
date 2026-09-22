import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHomeworkExtractPrompt,
  mergeHomeworkReferenceBank,
  parseExercise,
  parseHomeworkLesson,
} from "./buildHomeworkPrompt.ts";
import { computeHomeworkProgress, isGermanVerbFormOf, normalizeHomeworkBank } from "../../components/homework/homeworkAnswers.ts";

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

test("personal pronoun alternatives become separate dropdown blanks", () => {
  const exercise = parseExercise({
    number: 6,
    instruction: "Unterstreichen Sie das passende Personalpronomen.",
    widget: "open",
    items: [{
      number: 1,
      text: "Wann hast (1) du/dich/dir Geburtstag? Am ersten Mai. Ich lade (2) du/dich/dir ein.",
    }],
  });

  assert.ok(exercise);
  assert.equal(exercise.widget, "cloze");
  assert.equal(exercise.items?.[0].text, "Wann hast (1) {{0}} Geburtstag? Am ersten Mai. Ich lade (2) {{1}} ein.");
  assert.deepEqual(exercise.items?.[0].blanks, [
    { select: true, options: ["du", "dich", "dir"] },
    { select: true, options: ["du", "dich", "dir"] },
  ]);
});

test("the homework prompt exposes candidate dictionary packs and conjugated verb gaps", () => {
  const prompt = buildHomeworkExtractPrompt({
    referencePacks: [{ id: "batch-68", title: "Wortschatz Seite 68", pageLabel: "страница 68", kind: "учебник, с. 68", words: ["helfen", "schenken"] }],
  });
  assert.match(prompt, /referenceBatchId/u);
  assert.match(prompt, /Do not ask the learner to select a pack manually/u);
  assert.match(prompt, /conjugated form required/u);
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

test("season activity word banks become a sorter with a preserved worked example", () => {
  const exercise = parseExercise({
    number: 3,
    instruction: "Wann machen Sie was gerne? Schreiben Sie zwei Aktivitäten zu jeder Jahreszeit.",
    widget: "cloze",
    bank: ["Inliner fahren", "Ski fahren", "lesen"],
    items: [
      { number: 1, text: "Im Frühling: Inliner fahren, {{0}}" },
      { number: 2, text: "Im {{0}}: {{1}}, {{2}}" },
    ],
  });

  assert.ok(exercise);
  assert.equal(exercise.widget, "sort");
  assert.deepEqual(exercise.categories, ["Frühling", "Sommer", "Herbst", "Winter"]);
  assert.deepEqual(exercise.sortRows, [
    { number: 1, category: "Frühling", fixed: ["Inliner fahren"], slots: 2 },
    { number: 2, slots: 2 },
  ]);
});

test("a saved sorter is rehydrated from its linked dictionary pack", () => {
  const exercise = parseExercise({
    number: 7,
    instruction: 'Ordnen Sie Nomen aus „Ihr Wortschatz“ auf Seite 68 zu.',
    widget: "sort",
    categories: ["Feste", "Jahreszeiten", "Monate"],
  });

  assert.ok(exercise);
  const restored = mergeHomeworkReferenceBank(exercise, ["der Frühling", "der Geburtstag"], []);
  assert.deepEqual(restored.bank, ["der Frühling", "der Geburtstag"]);
  assert.deepEqual(restored.categories, ["Feste", "Jahreszeiten", "Monate"]);
});

test("homework dictionary banks prefer one article-bearing noun chip", () => {
  assert.deepEqual(normalizeHomeworkBank(["die Blume, -n", "Blume", "der April", "April", "der Durst (Sg.)"]), ["die Blume", "der April", "der Durst"]);
});

test("a conjugated verb marks its infinitive as used without accepting another verb", () => {
  assert.equal(isGermanVerbFormOf("gratuliere", "gratulieren"), true);
  assert.equal(isGermanVerbFormOf("dekorierst", "dekorieren"), true);
  assert.equal(isGermanVerbFormOf("gehen", "gratulieren"), false);
});

test("parts with the same printed number get isolated answer namespaces", () => {
  const lesson = parseHomeworkLesson({
    title: "Урок",
    description: "",
    exercises: [
      { number: 3, instruction: "a", widget: "open", items: [{ number: 1, text: "a" }] },
      { number: 3, instruction: "b", widget: "open", items: [{ number: 1, text: "b" }] },
      { number: 3, instruction: "c", widget: "open", items: [{ number: 1, text: "c" }] },
    ],
  });

  assert.ok(lesson);
  assert.deepEqual(lesson.exercises.map((exercise) => exercise.answerKey), ["3:1", "3:2", "3:3"]);
  assert.equal(computeHomeworkProgress(lesson.exercises, {
    items: { "3:1:1": "a", "3:2:1": "b" },
    conjugations: {},
  }), 67);
});
