// «Проверить и исправить карточку».
//
// The model sees everything the app knows about the card and answers in one of
// three ways: the card is right, here is the corrected card, or — when the word
// could mean several things and nothing on the card settles which — a question
// for the learner. It is never allowed to settle that by guessing: a confident
// wrong «fix» is worse than the original mistake, because the learner stops
// doubting the card.

export type CardVerifyDictionaryEntry = {
  headword: string;
  lemma: string;
  translation: string;
  partOfSpeech: string;
  gender: string;
  article: string;
  plural: string;
  forms: Record<string, string>;
  cefr: string;
  note: string;
  example: string;
  exampleTranslation: string;
};

export type CardVerifyClarification = { question: string; answer: string };

export type CardVerifyRequest = {
  card: {
    type: string;
    front: string;
    back: string;
    cefr: string;
    source: string;
  };
  /** The dictionary row the card was made from, when one is found. */
  entry: CardVerifyDictionaryEntry | null;
  /** Earlier rounds of this same check, oldest first. */
  clarifications: CardVerifyClarification[];
  targetLanguage: string;
  nativeLanguage: string;
};

export type CardVerifyResult =
  | { verdict: "ok"; note: string }
  | { verdict: "fix"; front: string; back: string; changes: string[]; note: string }
  | { verdict: "question"; question: string };

const LIMITS = { front: 300, back: 600, text: 400 } as const;

function clip(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

/** Model output where an empty field comes back as the word «null» or «none». */
function modelText(value: unknown, max: number): string {
  const text = clip(value, max);
  return /^(null|none|undefined)$/i.test(text) ? "" : text;
}

/** Cleans what the client sent so the prompt can never carry anything but plain fields. */
export function sanitizeVerifyRequest(raw: unknown): CardVerifyRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const body = raw as Record<string, unknown>;
  const card = typeof body.card === "object" && body.card !== null ? body.card as Record<string, unknown> : null;
  if (!card) return null;

  const front = clip(card.front, LIMITS.front);
  const back = String(card.back ?? "").replace(/\r\n/g, "\n").trim().slice(0, LIMITS.back);
  if (!front || !back) return null;

  let entry: CardVerifyDictionaryEntry | null = null;
  if (typeof body.entry === "object" && body.entry !== null) {
    const e = body.entry as Record<string, unknown>;
    const forms = typeof e.forms === "object" && e.forms !== null
      ? Object.fromEntries(Object.entries(e.forms as Record<string, unknown>)
        .map(([key, value]) => [key.slice(0, 30), clip(value, 120)] as const)
        .filter(([, value]) => value))
      : {};
    entry = {
      headword: clip(e.headword, 200),
      lemma: clip(e.lemma, 200),
      translation: clip(e.translation, LIMITS.text),
      partOfSpeech: clip(e.partOfSpeech, 60),
      gender: clip(e.gender, 20),
      article: clip(e.article, 20),
      plural: clip(e.plural, 120),
      forms,
      cefr: clip(e.cefr, 4),
      note: clip(e.note, LIMITS.text),
      example: clip(e.example, LIMITS.text),
      exampleTranslation: clip(e.exampleTranslation, LIMITS.text),
    };
  }

  const clarifications = (Array.isArray(body.clarifications) ? body.clarifications : [])
    .slice(0, 6)
    .map((item) => {
      const row = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
      return { question: clip(row.question, LIMITS.text), answer: clip(row.answer, 1000) };
    })
    .filter((item) => item.question && item.answer);

  return {
    card: {
      type: clip(card.type, 20) || "word",
      front,
      back,
      cefr: clip(card.cefr, 4),
      source: clip(card.source, 200),
    },
    entry,
    clarifications,
    targetLanguage: clip(body.targetLanguage, 20) || "de",
    nativeLanguage: clip(body.nativeLanguage, 20) || "ru",
  };
}

function describeEntry(entry: CardVerifyDictionaryEntry | null): string {
  if (!entry) return "No dictionary entry is linked to this card — the card text is all there is.";
  const lines = [
    `headword: ${entry.headword}`,
    entry.lemma && `lemma: ${entry.lemma}`,
    entry.translation && `translation: ${entry.translation}`,
    entry.partOfSpeech && `part of speech: ${entry.partOfSpeech}`,
    entry.article && `article: ${entry.article}`,
    entry.gender && `gender: ${entry.gender}`,
    entry.plural && `plural: ${entry.plural}`,
    ...Object.entries(entry.forms).map(([key, value]) => `form ${key}: ${value}`),
    entry.cefr && `level: ${entry.cefr}`,
    entry.note && `note: ${entry.note}`,
    entry.example && `example: ${entry.example}${entry.exampleTranslation ? ` — ${entry.exampleTranslation}` : ""}`,
  ].filter(Boolean);
  return lines.join("\n");
}

export function buildCardVerifyPrompt(request: CardVerifyRequest): string {
  const { card, entry, clarifications, targetLanguage, nativeLanguage } = request;
  const answered = clarifications.length > 0
    ? `The learner has already answered your earlier questions. Treat these answers as authoritative, never ask the same thing again:\n${clarifications
      .map((c, i) => `${i + 1}. Q: ${c.question}\n   A: ${c.answer}`)
      .join("\n")}`
    : "You have not asked the learner anything yet.";

  return `You are the quality checker of a flashcard deck inside a language-learning app.
The learner studies ${targetLanguage}; their native language is ${nativeLanguage}.

A flashcard is shown as: FRONT = the ${targetLanguage} word/phrase (a noun carries its article), BACK = first line is the ${nativeLanguage} translation, an optional second line holds the cheat sheet ("мн. ч.: …", verb forms like "praeteritum: …").
Learners report two kinds of defects: a wrong or misleading translation, and a card whose word is read as a different word than the one meant (for example the noun "die Stelle" — place, vacancy — treated as a form of the verb "stellen").

THE CARD
type: ${card.type}
front: ${card.front}
back:
${card.back}
level: ${card.cefr || "unknown"}
comes from: ${card.source || "unknown"}

DICTIONARY ENTRY THE CARD WAS MADE FROM
${describeEntry(entry)}

${answered}

Your job:
1. Decide what exactly the front means: which word, which part of speech, which gender/article, which sense. Use every field above. The article on the front, the part of speech and the translation must all describe the SAME word.
2. Check the translation, the article, the plural and any verb forms on the back for errors, and check that the back keeps the card's meaning (a card for "die Stelle" in the sense "место, вакансия" must not be explained as the verb "stellen").
3. Choose exactly one verdict:
   - "ok": the card is correct. Put a short reassurance in note (in ${nativeLanguage}).
   - "fix": something is demonstrably wrong. Return the corrected front and back IN FULL and list every change in changes (each one short, in ${nativeLanguage}, as "что было → что стало" or "что исправлено и почему").
   - "question": you cannot tell what the card is meant to be. This is REQUIRED — do not guess — when the front can mean several different words or senses and the back, the dictionary entry and the learner's earlier answers do not settle which one is meant; when the front and the back seem to describe different words and you cannot tell which is the intended one; or when you lack a fact you need. Ask ONE concrete question in ${nativeLanguage}, short, answerable in a sentence, naming the options you are weighing. Do not ask about things that are already clear from the card.

Rules for a fix:
- Change the minimum. Keep what is correct. Keep the front's article/format conventions and keep the back's two-part layout (translation on the first line, cheat sheet on the second line joined by " · "). Do not add information the original did not have, except a correct article/plural for a noun.
- Change the front only for a clear error (wrong article, misspelling, wrong word form for the card's purpose). Never change which word the card is about without a learner's answer saying so.
- Never invent a meaning, form, article or plural you are not sure of. When unsure, ask a question instead.
- If the learner's answer states what the card should be, make the card exactly that, with correct grammar details.

Return ONLY a JSON object: {"verdict": "ok"|"fix"|"question", "front": string, "back": string, "changes": string[], "note": string, "question": string}.
For "ok" set front/back to the current card text unchanged, changes to [] and question to "". For "question" set front/back to the current card text unchanged, changes to [] and fill question. For "fix" set question to "".`;
}

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
}

/**
 * Turns the model's payload into one of the three outcomes — or null when it is
 * unusable. A «fix» that changes nothing is reported as «ok» rather than shown
 * to the learner as an edit that edits nothing.
 */
export function normalizeVerifyResult(raw: unknown, current: { front: string; back: string }): CardVerifyResult | null {
  if (typeof raw !== "object" || raw === null) return null;
  const payload = raw as Record<string, unknown>;
  const verdict = String(payload.verdict ?? "").trim().toLowerCase();

  if (verdict === "question") {
    const question = modelText(payload.question, 600);
    return question ? { verdict: "question", question } : null;
  }

  const note = modelText(payload.note, 600);
  if (verdict === "ok") return { verdict: "ok", note };
  if (verdict !== "fix") return null;

  const front = clip(payload.front, LIMITS.front);
  const back = String(payload.back ?? "").replace(/\r\n/g, "\n").trim().slice(0, LIMITS.back);
  // A fix with an empty side would erase part of the card.
  if (!front || !back) return null;
  if (sameText(front, current.front) && sameText(back, current.back)) return { verdict: "ok", note };

  const changes = (Array.isArray(payload.changes) ? payload.changes : [])
    .map((item) => modelText(item, 300))
    .filter(Boolean)
    .slice(0, 8);
  return { verdict: "fix", front, back, changes, note };
}
