// Turning a photographed page of paper homework into a structured exercise set
// the learner fills in on their phone.
//
// This is deliberately not buildImageLessonPrompt's document flow: that one
// rewrites a page into prose to read. Homework is not read, it is done — and
// it is graded by the learner's own teacher, on paper, from a printout. So the
// model's job stops at recovering the exercise structure; it must never invent
// or fill in an answer, only describe where the learner's answer goes.
//
// Four interaction shapes cover almost any grammar drill:
//   - "cloze"        a numbered sentence with one or more blanks inside it.
//                     A blank is free text, or a dropdown when the exercise
//                     (or just this item) gives a fixed word bank to choose
//                     from ("Вставьте wer, was, wann...").
//   - "compose"      a numbered prompt answered by assembling words from a
//                     given bank ("Употребите в ответах слова, данные справа").
//                     Rendered as tappable chips plus a normal editable field —
//                     tapping and typing both land in the same answer.
//   - "open"         a numbered prompt with nothing to key blanks off —
//                     translation, an answer to a question, a word formed from
//                     a model — the learner just writes the whole thing.
//   - "conjugation"  not a list of sentences but a verb (or word) list, each
//                     opening a small pronoun × form grid.
//
// The model is NOT asked to pick a label from this list — that would be the
// "why bother with AI" trap the whole design tries to avoid. It is asked to
// describe the page: the instruction line, where each numbered item starts,
// where a blank sits inside it, whether a word bank exists and which items it
// belongs to. "widget" is just how that description routes to one of the four
// renderers below, and all four are written once, by hand — the model never
// generates UI, only this JSON.

// ─── Shape ────────────────────────────────────────────────────────────────

export type HomeworkBlank = {
  /** true → a dropdown built from the item's/exercise's bank. false → free text. */
  select: boolean;
};

export type HomeworkItem = {
  number: number;
  /**
   * The sentence or prompt as printed. For "cloze" items, blanks are marked
   * "{{0}}", "{{1}}", ... in reading order — never filled in, never guessed.
   * For "open" items there are no placeholders: the text is the whole prompt.
   */
  text: string;
  /** Present (and same length as the {{n}} count) only for "cloze" items. */
  blanks?: HomeworkBlank[];
  /** Overrides the exercise-level bank for just this item — see упр. 10, where each of 3 questions has its own word list. */
  bank?: string[];
};

export type HomeworkExercise = {
  number: number;
  /** The instruction line exactly as printed, e.g. "Вставьте правильные окончания." */
  instruction: string;
  widget: "cloze" | "compose" | "open" | "conjugation" | "text";
  /** cloze / compose / open. */
  items?: HomeworkItem[];
  /** Shared word bank for items in this exercise that don't carry their own. */
  bank?: string[];
  /** conjugation widget only: the infinitives to conjugate. */
  verbs?: string[];
  /** conjugation widget only: the pronoun/person labels implied by the exercise (e.g. ["ich","du","er/sie/es","wir","ihr","sie/Sie"]). */
  pronouns?: string[];
};

export type HomeworkLesson = {
  title: string;
  description: string;
  /** What the page appears to be, in Russian — e.g. "Учебник немецкого, с. 75–76, упражнения 1–15". */
  sourceKind: string;
  exercises: HomeworkExercise[];
};

// ─── Prompt ───────────────────────────────────────────────────────────────

export function buildHomeworkExtractPrompt(): string {
  return `You are reading a photograph of a page of language-learning exercises ("УПРАЖНЕНИЯ") for a study app. The learner will fill in every blank themselves, by hand equivalent, and print the result for their teacher — so your job is to recover the page's structure, never to solve it.

Rules, in order of importance:
- NEVER supply, guess, or imply a correct answer anywhere — not in a blank, not in an item's text, not in a field you invent. Every "{{n}}" you mark stays exactly that: a marker, nothing filled in.
- Transcribe instruction lines and item text exactly as printed, in their original language. Do not translate, simplify, or explain.
- Split the page into its numbered exercises (the bold "1.", "2." headings) in order. Skip a page header, date stamp, or page number — they are not exercises.
- Within an exercise, split into its numbered items (the "1.", "2." sentences/questions inside it) in reading order.
- Pick ONE widget per exercise, by what the instruction actually asks for:
  - "cloze": items are given sentences with one or more gaps to fill (dots, underscores, an ellipsis, a blank space before a mark). Mark each gap "{{0}}", "{{1}}", ... in the item's "text", in order, and add one entry to "blanks" per gap.
    - Decide "select" separately for EACH blank, never for the whole exercise at once. A blank is select:true only when the word that belongs there is genuinely one member of a small, closed, named set — either a bank printed elsewhere on the page, or a set the instruction line itself names by name (e.g. "Вставьте wer, was, wann, wie lange, wie" names its own 5-word set — put ["wer","was","wann","wie lange","wie"] in that exercise's "bank" even though no separate column is printed for it; "Вставьте личные местоимения du, ihr, Sie" names ["du","ihr","Sie"]).
    - When one item has several blanks and only some of them are filled from that named set — e.g. "Besuch{{0}}{{1}} einen Fremdsprachenkurs?" where {{0}} is the pronoun (du/ihr/Sie, from the bank) and {{1}} is that verb's personal ending (-st, -t, ..., not in the bank at all) — mark ONLY the blank(s) that actually take a bank word as select:true. The other blank(s) in the same item are select:false, even though they sit right next to a select blank. Never reuse the pronoun bank as the options for an ending blank.
    - Default to select:false whenever in doubt — a free-text blank the learner could have filled from the bank anyway costs nothing; a select blank offering the wrong options is actively wrong and worse than no dropdown.
  - "compose": the instruction says to build the answer out of words given elsewhere ("употребите слова, данные справа/ниже"). Each item is the prompt/question; its own word choices go in "bank" (per-item, since each prompt can have a different list — see a "Was ist das? / Wer ist das?" style exercise where each question has its own column of words).
  - "open": the item needs a whole sentence or phrase written with no gap to key off — translation, answering a question, forming a word from an example. Put the full prompt (including any given example) in "text", no "{{n}}" markers.
  - "conjugation": the instruction says to conjugate/decline a list of words. List them in "verbs", and put the pronoun or grammatical-person labels the exercise implies in "pronouns" (infer the standard set for the language if the page doesn't spell it out).
  - "text": the instruction references something outside this photo (e.g. "прочтите текст «Wir lernen Fremdsprachen»" when that text isn't on the page) or is otherwise not something to fill in here. No items.
- A word bank that is visually attached to a whole exercise (a column of adjectives, a list of nouns) but is meant to fill every gap in it belongs on the exercise's "bank", not repeated per item.
- If a page is cropped and an exercise is cut off mid-item, include only the items you can read in full.

Return ONLY valid JSON with this exact shape:
{
  "title": "short title in Russian naming the material (e.g. the textbook section)",
  "description": "one sentence in Russian saying what this page is",
  "sourceKind": "what the page is, in Russian (e.g. 'учебник, с. 75-76, упражнения 1-15')",
  "exercises": [
    {
      "number": 1,
      "instruction": "instruction line as printed",
      "widget": "cloze" | "compose" | "open" | "conjugation" | "text",
      "items": [ { "number": 1, "text": "...", "blanks": [ { "select": false } ], "bank": [] } ],
      "bank": [],
      "verbs": [],
      "pronouns": []
    }
  ]
}

No markdown, no commentary, nothing outside the JSON object.`;
}

// ─── Parsing ────────────────────────────────────────────────────────────────
//
// The Gemini response schema (Type.OBJECT/Type.ARRAY…) lives in lessonModel.ts
// next to the other response shapes, not here — this module stays free of the
// @google/genai import so client components can pull HomeworkLesson etc.
// straight from it.

const WIDGETS = new Set(["cloze", "compose", "open", "conjugation", "text"]);

function parseBlank(raw: unknown): HomeworkBlank | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  return { select: obj.select === true };
}

function parseItem(raw: unknown): HomeworkItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;
  const number = typeof obj.number === "number" ? obj.number : 0;
  const blanks = Array.isArray(obj.blanks)
    ? obj.blanks.map(parseBlank).filter((b): b is HomeworkBlank => b !== null)
    : undefined;
  const bank = Array.isArray(obj.bank)
    ? obj.bank.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    : undefined;
  return {
    number,
    text,
    ...(blanks && blanks.length > 0 ? { blanks } : {}),
    ...(bank && bank.length > 0 ? { bank } : {}),
  };
}

/** Exported so a saved lesson's stored exercises (read back from shared_book_chapters.paragraphs) can be re-validated the same way a fresh model answer is. */
export function parseExercise(raw: unknown): HomeworkExercise | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const instruction = typeof obj.instruction === "string" ? obj.instruction.trim() : "";
  const widget = typeof obj.widget === "string" && WIDGETS.has(obj.widget) ? obj.widget as HomeworkExercise["widget"] : null;
  if (!instruction || !widget) return null;

  const items = Array.isArray(obj.items)
    ? obj.items.map(parseItem).filter((i): i is HomeworkItem => i !== null)
    : undefined;
  const bank = Array.isArray(obj.bank)
    ? obj.bank.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    : undefined;
  const verbs = Array.isArray(obj.verbs)
    ? obj.verbs.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : undefined;
  const pronouns = Array.isArray(obj.pronouns)
    ? obj.pronouns.filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    : undefined;

  return {
    number: typeof obj.number === "number" ? obj.number : 0,
    instruction,
    widget,
    ...(items && items.length > 0 ? { items } : {}),
    ...(bank && bank.length > 0 ? { bank } : {}),
    ...(verbs && verbs.length > 0 ? { verbs } : {}),
    ...(pronouns && pronouns.length > 0 ? { pronouns } : {}),
  };
}

/** Narrow the model's raw JSON, or null when there is nothing usable in it. */
export function parseHomeworkLesson(raw: unknown): HomeworkLesson | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  const exercises = Array.isArray(obj.exercises)
    ? obj.exercises.map(parseExercise).filter((e): e is HomeworkExercise => e !== null)
    : [];
  if (!title || exercises.length === 0) return null;

  return {
    title,
    description: typeof obj.description === "string" ? obj.description.trim() : "",
    sourceKind: typeof obj.sourceKind === "string" ? obj.sourceKind.trim() : "",
    exercises,
  };
}
