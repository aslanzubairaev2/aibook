// Turning a photographed page of paper homework into a structured exercise set
// the learner fills in on their phone.
//
// This is deliberately not buildImageLessonPrompt's document flow: that one
// rewrites a page into prose to read. Homework is not read, it is done — and
// it is graded by the learner's own teacher, on paper, from a printout. So the
// model's job stops at recovering the exercise structure; it must never invent
// or fill in an answer, only describe where the learner's answer goes.
//
// Five interaction shapes cover almost any grammar drill:
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
//   - "formation"    a list of source words that must be transformed into
//                     one or more AI-described answer fields (word formation,
//                     translation, plural, feminine form, etc.).
//
// The model describes the page: the instruction line, where each numbered item
// starts, where a blank sits inside it, whether a word bank exists and which
// answer fields a transformation exercise actually asks for. The renderer is
// generic; the model never generates executable UI, only this JSON contract.

// ─── Shape ────────────────────────────────────────────────────────────────

export type HomeworkBlank = {
  /** true → a dropdown built from the item's/exercise's bank. false → free text. */
  select: boolean;
  /** A small per-blank choice list, e.g. ["du", "dich", "dir"]. */
  options?: string[];
};

export type HomeworkResponseField = {
  /** Stable key used only for metadata and future answer checking. */
  key: string;
  /** Short label shown next to the learner's input. */
  label: string;
};

export type HomeworkSortRow = {
  number: number;
  /** Printed category, or empty when the learner must choose it. */
  category?: string;
  /** Words already printed in a worked example and therefore not blanks. */
  fixed?: string[];
  /** Maximum number of words expected in the row, when the page makes it clear. */
  slots?: number;
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
  /** Overrides the exercise-level answer fields for a transformation item. */
  fields?: HomeworkResponseField[];
};

export type HomeworkExercise = {
  number: number;
  /** Stable answer namespace. Needed when a textbook has 3a, 3b and 3c. */
  answerKey?: string;
  /** The instruction line exactly as printed, e.g. "Вставьте правильные окончания." */
  instruction: string;
  widget: "cloze" | "compose" | "open" | "conjugation" | "formation" | "sort" | "text";
  /** cloze / compose / open. */
  items?: HomeworkItem[];
  /** Shared word bank for items in this exercise that don't carry their own. */
  bank?: string[];
  /** conjugation widget only: the infinitives to conjugate. */
  verbs?: string[];
  /** conjugation widget only: the pronoun/person labels implied by the exercise (e.g. ["ich","du","er/sie/es","wir","ihr","sie/Sie"]). */
  pronouns?: string[];
  /** formation widget: fields the learner must fill for each source item. */
  fields?: HomeworkResponseField[];
  /** sort widget: labels read from a picture/diagram. */
  categories?: string[];
  /** Optional row layout for word-bank exercises with per-row blanks/examples. */
  sortRows?: HomeworkSortRow[];
};

export type HomeworkLesson = {
  title: string;
  description: string;
  /** What the page appears to be, in Russian — e.g. "Учебник немецкого, с. 75–76, упражнения 1–15". */
  sourceKind: string;
  exercises: HomeworkExercise[];
  /** The dictionary pack the model identified from a page/vocabulary reference. */
  referenceBatchId?: string;
};

// ─── Prompt ───────────────────────────────────────────────────────────────

export type HomeworkPromptContext = {
  referenceTitle?: string;
  referenceWords?: string[];
  referencePacks?: Array<{
    id: string;
    title: string;
    kind?: string;
    description?: string;
    pageLabel?: string | null;
    words: string[];
  }>;
};

export function buildHomeworkExtractPrompt(context: HomeworkPromptContext = {}): string {
  const referenceBlock = context.referenceWords?.length
    ? `\nA dictionary pack was selected as a reference for this photo. It is the word list the page may refer to:\n- Pack: ${context.referenceTitle ?? "Словарь"}\n- Words: ${context.referenceWords.join(", ")}\nUse these words as the bank when the photographed instruction refers to that vocabulary/page. For a picture or diagram exercise, keep the words as an interactive bank and recover the visible category labels; do not silently omit the exercise.\n`
    : context.referencePacks?.length
      ? `\nThe learner's dictionary packs are available as reference candidates. If the photographed page says that an exercise uses a vocabulary list (for example \"Ihr Wortschatz auf Seite 68\"), identify the matching pack by its page number, title, or words and set its id in \"referenceBatchId\". Do not ask the learner to select a pack manually. Use the matching pack's words as the bank for that exercise; for picture/diagram exercises, recover the visible category labels and keep the words as an interactive bank.\n${context.referencePacks.map((pack) => `- id=${pack.id}; title=${pack.title}; page=${pack.pageLabel ?? ""}; kind=${pack.kind ?? ""}; description=${pack.description ?? ""}; words=${pack.words.join(", ")}`).join("\n")}\n`
      : "";
  return `You are reading a photograph of a page of language-learning exercises ("УПРАЖНЕНИЯ") for a study app. The learner will fill in every blank themselves, by hand equivalent, and print the result for their teacher — so your job is to recover the page's structure, never to solve it.
${referenceBlock}

Rules, in order of importance:
- NEVER supply, guess, or imply a correct answer anywhere — not in a blank, not in an item's text, not in a field you invent. Every "{{n}}" you mark stays exactly that: a marker, nothing filled in.
- Transcribe instruction lines and item text exactly as printed, in their original language. Do not translate, simplify, or explain.
- Split the page into its numbered exercises (the bold "1.", "2." headings) in order. Skip a page header, date stamp, or page number — they are not exercises.
- Within an exercise, split into its numbered items (the "1.", "2." sentences/questions inside it) in reading order.
- Pick ONE widget per exercise, by what the instruction actually asks for:
  - "cloze": items are given sentences with one or more gaps to fill (dots, underscores, an ellipsis, a blank space before a mark). Mark each gap "{{0}}", "{{1}}", ... in the item's "text", in order — copy the exact spacing and punctuation the page prints around and between them, do not add or remove a single space. This matters: a gap glued directly onto the end of a word with NO space ("Besuch{{0}}") is a suffix/ending being filled in; a gap that stands as its own word, with a space before it, is a separate word being filled in. Never collapse "word{{0}} {{1}} rest" into "word{{0}}{{1}} rest" — that space is the only thing telling the two gaps apart.
    - Decide "select" separately for EACH blank, never for the whole exercise at once. A blank is select:true only when the word that belongs there is genuinely one member of a small, closed, named set — either a bank printed elsewhere on the page, or a set the instruction line itself names by name (e.g. "Вставьте wer, was, wann, wie lange, wie" names its own 5-word set — put ["wer","was","wann","wie lange","wie"] in that exercise's "bank" even though no separate column is printed for it; "Вставьте личные местоимения du, ihr, Sie" names ["du","ihr","Sie"]).
    - A gap glued directly onto a word stem with no space before it (a suffix/ending — "-st", "-t", "-en") is NEVER select:true, even in an exercise whose bank is a list of pronouns: an ending is typed, never chosen from a pronoun list. Only a gap that stands as its own separate word AND is genuinely one of the bank's words gets select:true.
    - Worked example — "Besuch{{0}} {{1}} einen Fremdsprachenkurs?" in an exercise banked ["du","ihr","Sie"]: {{0}} sits glued to "Besuch" with no space before it, so it is the verb's own ending ("-st"/"-t"/"-en") — select:false. {{1}} has a space before it and stands as its own word — that is the pronoun slot — select:true. Getting this order backwards (selecting the ending, typing the pronoun) is exactly the mistake to avoid.
    - Default to select:false whenever in doubt — a free-text blank the learner could have filled from the bank anyway costs nothing; a select blank offering the wrong options is actively wrong and worse than no dropdown.
  - "compose": the instruction says to build the answer out of words given elsewhere ("употребите слова, данные справа/ниже"). Each item is the prompt/question; its own word choices go in "bank" (per-item, since each prompt can have a different list — see a "Was ist das? / Wer ist das?" style exercise where each question has its own column of words).
  - "open": the item needs a whole sentence or phrase written with no gap to key off — translation, answering a question, forming a word from an example. Put the full prompt (including any given example) in "text", no "{{n}}" markers.
  - "conjugation": the instruction says to conjugate/decline a list of words. List them in "verbs", and put the pronoun or grammatical-person labels the exercise implies in "pronouns" (infer the standard set for the language if the page doesn't spell it out).
  - "formation": the instruction asks to derive, transform, or form a new word from each source word (for example, form person-denoting nouns from verbs). Put each source word in an item "text" exactly as printed. Describe the requested answer columns in an exercise-level "fields" array. Each field has a stable English "key" (use "word", "article_word", "feminine", "plural", "translation", or "other") and a short Russian "label". Include only what the instruction asks for. For "Образуйте от глаголов существительные, обозначающие лица, переведите их на русский язык" use exactly [{"key":"word","label":"Существительное"},{"key":"translation","label":"Перевод"}]. Do not route a word-formation task to "conjugation" just because its source list contains verbs.
  - "sort": a picture/diagram or word-bank task asks to put words into named categories. Return the visible category labels in "categories" and the available words in "bank". Do not solve or omit it just because answers are represented by pictures. For a task such as "Schreiben Sie zwei Aktivitäten zu jeder Jahreszeit", use "sort" (not "cloze"): return one "sortRows" entry per printed row, keep a worked-example word in "fixed" (it is already answered), and put only the still-empty choices into the row's slots. A row whose category is blank must have an empty "category" so the learner can choose it.
  - "text": only when the instruction references something outside this photo and there is no answer area to fill in here. For self-writing tasks such as "Ihre Sätze und Wörter" or "Ihr Text", use "open" with one item containing the printed prompt, so the learner gets a text area.
- Do not omit an exercise merely because it contains pictures or blank lines. Exercises that ask the learner to write their own examples must still be represented as "open".
  - For an exercise that says to complete sentences with verbs from a vocabulary list, keep the verb word bank as a hint but make each sentence gap free text: the learner must type the conjugated form required by the surrounding pronoun, not select an infinitive.

- Never reuse the same numeric exercise number as an answer identity: textbooks often label several parts "3a", "3b", "3c". The application assigns a separate answer namespace after parsing, so each field must remain independent.
- For an exercise that asks to underline/select the correct personal pronoun and prints alternatives such as "du/dich/dir", replace each slash-separated group with its own "{{n}}" marker and set that blank's "options" to the exact alternatives. Do not turn the whole dialogue into one open text field.
- A word bank that is visually attached to a whole exercise (a column of adjectives, a list of nouns) but is meant to fill every gap in it belongs on the exercise's "bank", not repeated per item.
- If a page is cropped and an exercise is cut off mid-item, include only the items you can read in full.

Return ONLY valid JSON with this exact shape:
{
  "title": "short title in Russian naming the material (e.g. the textbook section)",
  "description": "one sentence in Russian saying what this page is",
  "sourceKind": "what the page is, in Russian (e.g. 'учебник, с. 75-76, упражнения 1-15')",
  "referenceBatchId": "id of the matching dictionary pack, or an empty string when no vocabulary reference is present",
  "exercises": [
    {
      "number": 1,
      "instruction": "instruction line as printed",
      "widget": "cloze" | "compose" | "open" | "conjugation" | "formation" | "sort" | "text",
      "items": [ { "number": 1, "text": "...", "blanks": [ { "select": false, "options": ["du", "dich", "dir"] } ], "bank": [] } ],
      "bank": [],
      "verbs": [],
      "pronouns": [],
      "fields": [ { "key": "word", "label": "Существительное" }, { "key": "translation", "label": "Перевод" } ],
      "categories": ["Feste", "Jahreszeiten", "Monate"],
      "sortRows": [ { "number": 1, "category": "Frühling", "fixed": ["Inliner fahren"], "slots": 2 } ]
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

const WIDGETS = new Set(["cloze", "compose", "open", "conjugation", "formation", "sort", "text"]);

function parseField(raw: unknown): HomeworkResponseField | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const key = typeof obj.key === "string" ? obj.key.trim().slice(0, 48) : "";
  const label = typeof obj.label === "string" ? obj.label.trim().slice(0, 80) : "";
  if (!key || !label) return null;
  return { key, label };
}

function parseFields(raw: unknown): HomeworkResponseField[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const fields = raw.map(parseField).filter((field): field is HomeworkResponseField => field !== null);
  return fields.length > 0 ? fields.slice(0, 8) : undefined;
}

function cleanWordList(raw: unknown, limit = 24): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, limit);
}

function parseSortRows(raw: unknown): HomeworkSortRow[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw.flatMap((value): HomeworkSortRow[] => {
    if (typeof value !== "object" || value === null) return [];
    const obj = value as Record<string, unknown>;
    const number = typeof obj.number === "number" ? obj.number : 0;
    if (!number) return [];
    const category = typeof obj.category === "string" ? obj.category.trim() : "";
    const fixed = cleanWordList(obj.fixed ?? obj.fixedWords, 8);
    const slots = typeof obj.slots === "number" && Number.isFinite(obj.slots)
      ? Math.max(1, Math.min(8, Math.round(obj.slots)))
      : undefined;
    return [{
      number,
      ...(category ? { category } : {}),
      ...(fixed.length > 0 ? { fixed } : {}),
      ...(slots ? { slots } : {}),
    }];
  });
  return rows.length > 0 ? rows.slice(0, 24) : undefined;
}

const SEASON_NAMES = ["Frühling", "Sommer", "Herbst", "Winter"];

function isSeasonActivityExercise(instruction: string, items: HomeworkItem[] | undefined): boolean {
  const text = `${instruction} ${(items ?? []).map((item) => item.text).join(" ")}`;
  return /(aktivität|aktivitäten|activity|activities)/iu.test(text)
    && /(jahreszeit|jahreszeiten|season|seasons)/iu.test(text);
}

function deriveSeasonFromItem(text: string): string | undefined {
  return SEASON_NAMES.find((season) => new RegExp(`\\b${season}\\b`, "iu").test(text));
}

function deriveFixedWordsFromItem(text: string): string[] {
  const colonIndex = text.indexOf(":");
  if (colonIndex < 0) return [];
  return text.slice(colonIndex + 1)
    .split(",")
    .map((part) => part.replace(/\{\{\d+\}\}/gu, "").replace(/[._…]+/gu, "").trim())
    .filter((part) => part.length > 1);
}

/**
 * A small safety net for saved lessons produced before the generic formation
 * widget existed. The instruction is the source of truth: a list of verbs is
 * not enough to decide that an exercise is conjugation.
 */
function isPersonNounFormationInstruction(instruction: string): boolean {
  const text = instruction.toLocaleLowerCase();
  const nounCue = /(существитель|substantiv|\bnomen\b)/u.test(text);
  const personCue = /(лиц|person|personen|bezeichn|человек)/u.test(text);
  return nounCue && personCue;
}

function fieldsForFormationInstruction(instruction: string): HomeworkResponseField[] {
  const text = instruction.toLocaleLowerCase();
  const fields: HomeworkResponseField[] = [{ key: "word", label: "Существительное" }];
  if (/(женск|weib|feminin)/u.test(text)) fields.push({ key: "feminine", label: "Женская форма" });
  if (/(множествен|plural)/u.test(text)) fields.push({ key: "plural", label: "Множественное число" });
  if (/(перевед|перевод|русск|übersetz|uebersetz|bedeut)/u.test(text)) fields.push({ key: "translation", label: "Перевод" });
  return fields;
}

function parseBlank(raw: unknown): HomeworkBlank | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const options = Array.isArray(obj.options)
    ? obj.options
      .filter((option): option is string => typeof option === "string" && option.trim().length > 0)
      .map((option) => option.trim())
      .filter((option, index, all) => all.indexOf(option) === index)
      .slice(0, 12)
    : [];
  return {
    select: obj.select === true || options.length > 1,
    ...(options.length > 1 ? { options } : {}),
  };
}

function parseItem(raw: unknown): HomeworkItem | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const text = typeof obj.text === "string" ? obj.text.trim() : "";
  if (!text) return null;
  const number = typeof obj.number === "number" ? obj.number : 0;
  const explicitBlanks = Array.isArray(obj.blanks)
    ? obj.blanks.map(parseBlank).filter((b): b is HomeworkBlank => b !== null)
    : undefined;
  // Some model responses contain the contract markers but omit the parallel
  // blanks array. Infer free-text slots so old/sparse responses never leak
  // {{0}} into the learner-facing exercise.
  const markerCount = [...text.matchAll(/\{\{\d+\}\}/g)].length;
  const blanks = markerCount > 0
    ? Array.from({ length: markerCount }, (_, index) => explicitBlanks?.[index] ?? { select: false })
    : explicitBlanks;
  const bank = Array.isArray(obj.bank)
    ? obj.bank.filter((b): b is string => typeof b === "string" && b.trim().length > 0)
    : undefined;
  const fields = parseFields(obj.fields);
  return {
    number,
    text,
    ...(blanks && blanks.length > 0 ? { blanks } : {}),
    ...(bank && bank.length > 0 ? { bank } : {}),
    ...(fields ? { fields } : {}),
  };
}

const PERSONAL_PRONOUN_CHOICE_RE = /\b(?:ich\s*\/\s*mich\s*\/\s*mir|du\s*\/\s*dich\s*\/\s*dir|ihr\s*\/\s*euch|wir\s*\/\s*uns|er\s*\/\s*ihn\s*\/\s*ihm|sie\s*\/\s*ihr|Sie\s*\/\s*Ihr)\b/giu;

function isPersonalPronounChoiceInstruction(instruction: string): boolean {
  return /(personalpronomen|personal pronoun|личн(?:ые|ых)\s+местоимени|местоимени)/iu.test(instruction)
    && /(unterstreich|passend|выберите|подчерк)/iu.test(instruction);
}

/** Recover per-blank dropdowns when the model preserved printed alternatives as text. */
function normalizePersonalPronounChoices(item: HomeworkItem): HomeworkItem {
  const choiceIndices: Array<{ index: number; options: string[] }> = [];
  const existingMarkerCount = [...item.text.matchAll(/\{\{\d+\}\}/g)].length;
  let nextIndex = existingMarkerCount;
  const text = item.text.replace(PERSONAL_PRONOUN_CHOICE_RE, (choice) => {
    const options = choice.split(/\s*\/\s*/u).map((option) => option.trim());
    const index = nextIndex++;
    choiceIndices.push({ index, options });
    return `{{${index}}}`;
  });
  if (choiceIndices.length === 0) return item;

  const blanks = Array.from({ length: nextIndex }, (_, index) => item.blanks?.[index] ?? { select: false });
  for (const choice of choiceIndices) {
    blanks[choice.index] = { select: true, options: choice.options };
  }
  return { ...item, text, blanks };
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
  const fields = parseFields(obj.fields);
  const categories = Array.isArray(obj.categories)
    ? obj.categories
      .filter((category): category is string => typeof category === "string" && category.trim().length > 0)
      .map((category) => category.trim())
      .slice(0, 12)
    : undefined;
  const sortRows = parseSortRows(obj.sortRows);
  const activitySort = isSeasonActivityExercise(instruction, items);
  const itemBank = cleanWordList(items?.flatMap((item) => item.bank ?? []), 180);
  const activityBank = activitySort
    ? Array.from(new Set([...(bank ?? []), ...itemBank])).slice(0, 180)
    : bank;
  const activityRows = activitySort && items
    ? items.map((item) => {
      const category = deriveSeasonFromItem(item.text);
      const fixed = deriveFixedWordsFromItem(item.text);
      return {
        number: item.number,
        ...(category ? { category } : {}),
        ...(fixed.length > 0 ? { fixed } : {}),
        slots: 2,
      } satisfies HomeworkSortRow;
    })
    : undefined;
  const normalizedCategories = activitySort
    ? (categories && categories.some((category) => SEASON_NAMES.includes(category)) ? categories : SEASON_NAMES)
    : categories;
  const normalizedSortRows = sortRows ?? activityRows;

  const formationByInstruction = isPersonNounFormationInstruction(instruction);
  const sourceItems = items && items.length > 0
    ? items
    : ((formationByInstruction || widget === "formation") && verbs && verbs.length > 0
      ? verbs.map((verb, index) => ({ number: index + 1, text: verb }))
      : undefined);
  const pronounChoiceExercise = isPersonalPronounChoiceInstruction(instruction);
  const normalizedItems = pronounChoiceExercise && sourceItems
    ? sourceItems.map(normalizePersonalPronounChoices)
    : sourceItems;
  const hasMarkers = normalizedItems?.some((item) => /\{\{\d+\}\}/.test(item.text)) === true;
  const writingCue = /(ihre sätze|ihr text|schreiben sie|для себя|напишите|свои предложения|текст)/iu.test(instruction);
  const normalizedWidget = activitySort
    ? "sort"
    : formationByInstruction && sourceItems && sourceItems.length > 0
    ? "formation"
    : hasMarkers && widget !== "conjugation" && widget !== "formation"
      ? "cloze"
      : widget === "text" && writingCue
        ? "open"
        : widget;
  const normalizedFields = normalizedWidget === "formation"
    ? fields ?? fieldsForFormationInstruction(instruction)
    : fields;

  return {
    number: typeof obj.number === "number" ? obj.number : 0,
    ...(typeof obj.answerKey === "string" && obj.answerKey.trim() ? { answerKey: obj.answerKey.trim().slice(0, 80) } : {}),
    instruction,
    widget: normalizedWidget,
    ...(normalizedItems && normalizedItems.length > 0 ? { items: normalizedItems } : {}),
    ...(activityBank && activityBank.length > 0 ? { bank: activityBank } : {}),
    ...(verbs && verbs.length > 0 ? { verbs } : {}),
    ...(pronouns && pronouns.length > 0 ? { pronouns } : {}),
    ...(normalizedFields && normalizedFields.length > 0 ? { fields: normalizedFields } : {}),
    ...(normalizedCategories && normalizedCategories.length > 0 ? { categories: normalizedCategories } : {}),
    ...(normalizedSortRows && normalizedSortRows.length > 0 ? { sortRows: normalizedSortRows } : {}),
  };
}

export function assignHomeworkAnswerKeys(exercises: HomeworkExercise[]): HomeworkExercise[] {
  const counts = new Map<number, number>();
  for (const exercise of exercises) counts.set(exercise.number, (counts.get(exercise.number) ?? 0) + 1);
  const occurrences = new Map<number, number>();
  return exercises.map((exercise) => {
    if (exercise.answerKey) return exercise;
    const occurrence = (occurrences.get(exercise.number) ?? 0) + 1;
    occurrences.set(exercise.number, occurrence);
    return {
      ...exercise,
      answerKey: counts.get(exercise.number) === 1
        ? String(exercise.number)
        : `${exercise.number}:${occurrence}`,
    };
  });
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
    ...(typeof obj.referenceBatchId === "string" && obj.referenceBatchId.trim()
      ? { referenceBatchId: obj.referenceBatchId.trim() }
      : {}),
    exercises: assignHomeworkAnswerKeys(exercises),
  };
}
