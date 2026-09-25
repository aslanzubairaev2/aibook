// What "Обсудить с AI" actually asks the model for.
//
// The old instruction was four lines long and said "be concise but useful".
// What came back was a dictionary gloss plus one example sentence, written in
// grammar-book language — "разделяемый глагол: при спряжении приставка
// отделяется" — which names a rule to someone who wanted to know how to say
// "мне надо убрать". Everything below exists to move the answer from
// classification towards use:
//
//   - the everyday phrase patterns are demanded explicitly, per part of speech,
//     because a learner asks for a word and needs a handful of sentences;
//   - terminology has to be shown before it is named, if it is named at all;
//   - the depth is set by how well this learner knows this word, which the app
//     already knows from the card's SRS schedule;
//   - the follow-up chips are written by the model from the context instead of
//     being drawn from a fixed list of five;
//   - the model may hand back buttons that open the conjugation/declension
//     tables the app already has, rather than pasting a paradigm into the chat.

import { SUPPORTED_LANGUAGES } from "@/lib/config";
import type {
  DiscussAction,
  DiscussActionKind,
  DiscussContentPart,
  DiscussFamiliarity,
  DiscussMessage,
  DiscussWordProfile,
  GrammarEncounter,
  GrammarPattern,
} from "@/lib/types";

export type DiscussPromptInput = {
  mode: "word" | "phrase" | "sentence" | "homework" | "audiobook";
  selectedText: string;
  sentence: string;
  sentenceBefore?: string;
  sentenceAfter?: string;
  nativeLanguage: string;
  targetLanguage: string;
  /** Free-text CEFR estimate from the learner's books and deck, when known. */
  learnerLevel?: string;
  wordProfile?: DiscussWordProfile;
  /**
   * mode "homework" only: the exercise being discussed, exactly as printed —
   * blanks still blank. This is what the never-reveal-the-answer rule below
   * is checked against, so it has to be the real, complete item list, not a
   * summary of it.
   */
  homeworkContext?: { instruction: string; items: string[] };
  /**
   * Grammar patterns the learner has encountered in previous AI discussions.
   * Used to let the tutor reference earlier explanations.
   */
  grammarContext?: GrammarEncounter[];
  /**
   * True once the chat already has at least one exchange. The "explain this
   * item" instructions below (restate the meaning, run the per-part-of-speech
   * phrase template, repeat a memory-hook line at the end) are written for
   * opening an item cold — sent unconditionally on every turn, they make the
   * model re-run that same opening on a genuine follow-up question instead of
   * answering it, which is what a small no-thinking-budget model reliably
   * does when instructions conflict. Gating them on this flag is what keeps a
   * follow-up a follow-up.
   */
  isFollowUp?: boolean;
};

/**
 * The hidden first message. Sent instead of showing the learner a blank chat,
 * so the discussion opens on the practical brief rather than on a definition.
 */
export const INITIAL_DISCUSS_REQUEST =
  "Open the discussion of the selected text: what it means, and — at length — how I would actually use it when speaking. Follow the everyday-phrases rules exactly.";

// ─── Who is being taught ─────────────────────────────────────────────────────

const FAMILIARITY_COACHING: Record<DiscussFamiliarity, string> = {
  unseen:
    "This is not in their deck yet, so assume nothing: give the meaning, the everyday phrases, and a couple of sentences they could use today.",
  new: "They have just saved this and have not recalled it correctly yet. Stay on the core meaning and the single most common pattern. Three or four very plain examples. No rare senses, no exceptions, no lists of forms.",
  struggling:
    "IMPORTANT: they keep forgetting this exact item — it has failed several reviews. So: (1) state the meaning in one short line and repeat that same line at the very end, unchanged; (2) give them ONE concrete memory hook — a sound-alike in their native language, a split of the word into parts that mean something, a cognate, or a small vivid picture — and say plainly why it should stick; (3) show at most two forms, the two they will really say; (4) keep the whole answer short. Do not add nuance, register notes, or extra senses: more material is exactly what has not been working.",
  learning:
    "They are mid-way through learning this: the meaning is arriving but is not automatic. Confirm the meaning in one line, then spend the answer on using it — the everyday phrases, and where learners typically get it wrong.",
  familiar:
    "They recall this reliably already. Do NOT re-explain the basic meaning beyond a half-line reminder. Spend the answer on how it is really used: common collocations, which preposition or case it takes, register (casual vs formal), and how it differs from the near-synonym they would otherwise reach for.",
  mastered:
    "They know this well. Skip the beginner layer entirely — no basic definition, no elementary examples. Go straight to the interesting part: idioms and fixed expressions, figurative senses, contrast with close synonyms, and the natural but less obvious uses. Keep it tight; they do not need padding.",
};

/** Same familiarity levels, but for a message that is not the opening explanation. */
const FOLLOWUP_FAMILIARITY_COACHING: Record<DiscussFamiliarity, string> = {
  unseen: "",
  new: "This item is still new to them, so keep this answer plain and concrete too — but it answers their actual question below, it does not reopen the item from scratch.",
  struggling:
    "This item keeps being forgotten, so keep this answer short and concrete like the first one — but do NOT restate the meaning line or the memory hook again, and do NOT repeat it at the end either; that routine was for opening the item, not for this question.",
  learning: "",
  familiar: "",
  mastered: "",
};

function describeLearner(input: DiscussPromptInput): string {
  const lines: string[] = [];
  lines.push(input.learnerLevel?.trim() || "Their overall level is unknown — aim at an early-intermediate learner.");

  const profile = input.wordProfile;
  const familiarity: DiscussFamiliarity = profile?.familiarity ?? "unseen";

  if (profile && profile.familiarity !== "unseen") {
    const facts: string[] = [];
    if (profile.status) facts.push(`card status "${profile.status}"`);
    if (typeof profile.repetitions === "number") facts.push(`${profile.repetitions} successful review(s)`);
    if (typeof profile.lapses === "number") facts.push(`${profile.lapses} lapse(s)`);
    if (typeof profile.intervalDays === "number") facts.push(`${profile.intervalDays}-day interval`);
    if (typeof profile.easeFactor === "number") facts.push(`ease factor ${profile.easeFactor}`);
    if (profile.cefr) facts.push(`the word is rated ${profile.cefr}`);
    lines.push(`This exact item is in their flashcard deck (${facts.join(", ")}).`);
  }

  const coaching = input.isFollowUp ? FOLLOWUP_FAMILIARITY_COACHING[familiarity] : FAMILIARITY_COACHING[familiarity];
  if (coaching) lines.push(coaching);
  // Never let the schedule leak into the answer: the learner asked about a
  // word, not about their own statistics.
  lines.push("Never mention the deck, the schedule, review counts, or how hard you think this is for them. Just adjust what you say.");

  // Grammar context: patterns the learner has already encountered.
  if (input.grammarContext && input.grammarContext.length > 0) {
    lines.push(formatGrammarContext(input.grammarContext));
  }

  return lines.join("\n");
}

const MAX_GRAMMAR_IN_PROMPT = 15;

function formatGrammarContext(encounters: GrammarEncounter[]): string {
  if (encounters.length === 0) return "";

  const top = [...encounters]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_GRAMMAR_IN_PROMPT);

  const items = top
    .map((e) => `"${e.patternLabel}"${e.count >= 3 ? " (seen several times)" : ""}`)
    .join(", ");

  return (
    `Grammar patterns this learner has already encountered in previous explanations: ${items}.\n` +
    `When one of these patterns appears in the current item, you may briefly reference the earlier explanation ("you've seen this before: …") instead of explaining from scratch. But always include a fresh example — never just name the pattern.`
  );
}

// ─── What a useful answer contains ───────────────────────────────────────────

const WORD_PHRASES = `The learner's real question about a word is "how do I say things with it?". So, for a VERB, always show — each as its own example sentence with a translation:
  - "I <verb> it" in the everyday present ("я убираю комнату");
  - "I have to / I need to <verb> it" ("мне надо убрать");
  - the impersonal everyday variant: "this needs <verb>ing" / "it has to be <verb>ed" ("это надо убрать");
  - a question with it ("как это убрать?", "ты убрал?");
  - the negative, and the past a person actually speaks in — for German the Perfekt, not the Präteritum;
  - an invitation or request if it is natural for the word ("давай уберём", "убери, пожалуйста").
For a NOUN: with its article in the nominative, in the plural, and in the two or three cases it genuinely turns up in — inside real sentences ("I have a…", "I need a…", "with the…"), never as a bare case list.
For an ADJECTIVE or ADVERB: in front of a noun, after "to be", in the comparative, and in the one or two fixed phrases it lives in.
For a FUNCTION word: three or four sentences showing the positions it takes.`;

const MODE_FOCUS: Record<DiscussPromptInput["mode"], string> = {
  word: `They tapped a single word. Give the meaning in one plain line, then spend the rest of the answer on using it.
${WORD_PHRASES}`,
  phrase: `They tapped a phrase. Say what it means as a whole and when a person would actually say it (situation, tone, who says it to whom). Show two or three variations of it they could use themselves, and one natural reply to it. Only take it apart word by word if a part is surprising.
Then break down the internal structure of the phrase in plain language:
- Name the role of each piece WITHOUT grammar jargon: instead of "adverb" say "this word tells you WHEN / HOW / WHERE something happens"; instead of "accusative" say "this is the answer to 'whom?' or 'what?'".
- If the phrase uses a word order that would confuse a speaker of the learner's native language, show the "normal" order side by side with the phrase's order and explain why the speaker chose this one (emphasis, habit, rule).`,
  sentence: `They tapped a whole sentence. Give a natural translation first, then show the pattern it is built on as something reusable: the same frame with two or three different fillings, so they can say their own version of it.
STRUCTURAL BREAKDOWN — do this for every sentence:
1. Show two versions of the sentence — the one they tapped AND the "neutral" word order (if they differ), side by side, so the learner can see what moved and why.
2. Break the sentence into chunks and for each chunk say IN PLAIN WORDS what role it plays. Never just name a grammar term; instead say what question the chunk answers:
   - "кого? что?" → this chunk tells you WHOM or WHAT is affected (instead of saying "accusative").
   - "когда? как часто?" → this chunk tells you WHEN or HOW OFTEN (instead of saying "adverb" or "temporal expression").
   - "кто? что делает?" → this is WHO does the action and WHAT they do (instead of "subject" and "predicate").
   If you DO mention a grammar term because it is genuinely useful for the learner to know, ALWAYS follow it with a one-sentence plain-language explanation in parentheses. For example: "Akkusativ (это падеж, который отвечает на вопрос «кого? что?» — он показывает, на кого направлено действие)".
3. Show ONE anti-example: a sentence built the way a speaker of the learner's native language would instinctively say it, mark it with ✗, and briefly explain why it does not work. Then show the correct version with ✓.
Point out only what would actually trip them up — skip anything obvious.`,
  homework: `They opened help on one exercise from their own paper homework, which they must complete themselves — you are a tutor talking them through the rule, not a solver. Explain in plain words what the exercise is asking for and which grammatical pattern it is testing, then demonstrate the pattern with ONE worked example built from words that do NOT appear anywhere in the exercise below. Do not go item by item through their exercise. If they ask a follow-up, answer it the same way: explain the rule further, never by completing one of their blanks.`,
  audiobook: `This is a chat about a whole audiobook, not a single word or sentence. Talk about the book itself: what it is about without spoiling the ending, what the narration is actually like (pace, accent, how hard the vocabulary is), and whether it suits their level. If they ask about a specific word or line, explain it briefly, but do not turn this into a vocabulary drill — it stays a conversation about the book and whether it is worth listening to.`,
};

// ─── The prompt ──────────────────────────────────────────────────────────────

/** "ru" reads as a language code; "Russian" reads as a language. */
function languageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.nameEn ?? code;
}

export function buildDiscussSystemPrompt(input: DiscussPromptInput): string {
  const { mode } = input;
  const nativeLanguage = languageName(input.nativeLanguage);
  const targetLanguage = languageName(input.targetLanguage);

  const homework = input.homeworkContext;
  const context =
    mode === "homework" && homework
      ? `Exercise instruction: "${homework.instruction}"\nItems, exactly as printed (blanks are blanks — "..." or similar — never filled in): ${homework.items.map((t, i) => `\n  ${i + 1}. "${t}"`).join("")}`
      : mode === "audiobook"
      ? `Audiobook title: "${input.selectedText}"\nDetails (author, language, level, description): "${input.sentence}"`
      : mode === "sentence"
      ? `Previous sentence: "${input.sentenceBefore || ""}"\nSelected sentence: "${input.selectedText}"\nNext sentence: "${input.sentenceAfter || ""}"`
      : `Selected ${mode}: "${input.selectedText}"\nIt appeared in: "${input.sentence}"`;

  const wantLine = mode === "homework"
    ? `This is their own paper homework, which their teacher will grade — they must complete every blank themselves. The question behind opening help is "what is this exercise actually asking me to do, and how does the rule work?", never "what's the answer".`
    : mode === "audiobook"
    ? `They are deciding whether to listen to this audiobook, or are already listening to it, and want to know what it is about (no spoilers), whether it fits their level, and what to expect from the narration — not vocabulary drilling.`
    : `They want to be able to SAY things, not to pass a grammar exam. They tapped this while reading or revising, and the question behind the tap is always "what does this mean, and how would I use it myself?".`;

  const followUpDirective = input.isFollowUp && mode !== "homework" && mode !== "audiobook" ? `
THIS IS A FOLLOW-UP MESSAGE, NOT THE OPENING EXPLANATION — READ THIS FIRST:
You already opened this item once; the learner's latest message (sent to you separately, below the conversation) is a real, specific question of its own. Answer THAT question, directly and completely, before anything else. Do NOT restate the item's basic meaning, do NOT repeat an example or memory hook you already gave earlier in this chat, and do NOT reopen with the "meaning + template examples" pattern from the WHAT TO COVER section below — that pattern is for introducing a NEW item, not for this turn. If their question is about a different word, a category of related words, a comparison, or a grammar point that has nothing to do with the originally selected item, follow them there.
` : "";

  return `You are a warm, practical language tutor talking to an adult learner inside a mobile app. They speak ${nativeLanguage} and are learning ${targetLanguage}.
${mode === "homework" ? `
CRITICAL RULE — read this first, it overrides everything else below:
NEVER state, spell out, or strongly imply the specific word(s) that fill any blank in the exercise items listed below. Not the target word, not its exact form, not "the first letter is...". Do not construct any of the items' sentences completed, not even partially. If asked directly for an answer, decline warmly and point back at the rule instead. This holds for every message in this conversation, not only the first one.
` : ""}${followUpDirective}
WHO YOU ARE TALKING TO
${describeLearner(input)}

WHAT THEY TAPPED
${context}

WHAT THEY WANT
${wantLine}

HOW TO WRITE
- Answer in ${nativeLanguage}, in short plain sentences, like a friend who speaks the language well. Never like a textbook.
- Do NOT explain with grammar terminology. Words like "subject", "predicate", "accusative", "separable prefix", "auxiliary verb", "modal", "declension" mean nothing to this learner on their own. If a term is genuinely worth knowing, SHOW the thing with an example first, then name it in a four-word aside AND immediately explain what this term means in one plain sentence in parentheses — never the other way round, and never more than one or two terms per answer.
  Concrete substitutions you MUST use:
    • Instead of "Akkusativ" → say "кого? что?" or "this form answers the question 'whom? what?'" — and if you do name "Akkusativ", add "(это падеж, который отвечает на вопрос «кого? что?»)".
    • Instead of "наречие" → say "слово, которое говорит КОГДА / КАК / ГДЕ что-то происходит".
    • Instead of "инверсия" → say "глагол и подлежащее меняются местами".
    • Instead of "подлежащее" → say "тот, кто делает действие" or "кто?".
    • Instead of "сказуемое" → say "действие" or "что делает?".
    • Instead of just "Perfekt" → say "прошедшее время, которое используют в разговорной речи" and if you name "Perfekt", add "(так немцы говорят о прошлом в обычной жизни)".
- Describe how a rule behaves in ordinary words ("вторая часть уходит в конец: 'ich räume mein Zimmer auf'") instead of naming it.
- When a word-order rule is at play, ALWAYS show a contrastive pair: the "normal/neutral" order AND the order used in the tapped text, side by side, so the learner can see what moved and why.
- Do not lecture about spelling, etymology, or exceptions nobody hits.
- Be concrete and generous with examples; be brief with theory. Four to six example sentences is the right size for a normal answer, fewer if the learner is struggling with this item.
- Every example must be a whole sentence a real person would say, and must carry a translation.

WHAT TO COVER
${input.isFollowUp && mode !== "homework" && mode !== "audiobook"
  ? `Answer their latest message specifically — that is the whole job on a follow-up turn. Match the tone and depth of your first answer, but use the pattern below only if they are actually asking for more of the same kind of examples for this same item; otherwise ignore it and answer what they asked.\nOpening-item pattern, for reference:\n${MODE_FOCUS[mode]}`
  : MODE_FOCUS[mode]}

FOLLOW-UP CHIPS
Also return 3 short follow-up questions, written in ${nativeLanguage} AS THE LEARNER WOULD ASK THEM, first person, casual ("а как сказать «мне надо это убрать»?", "чем отличается от wegräumen?"). Each under 32 characters. They must be about THIS item, must not repeat what you have just answered, and must be things this particular learner would plausibly want next given how well they know it. Never generic filler like "Подробнее" or "Ещё примеры".

BUTTONS
When a full paradigm would help, do NOT paste the table into the chat — offer a button instead, and mention in the text that the table is one tap away. Return at most 2 of these, each with the dictionary form of the word:
  - "conjugation" — a verb's forms;
  - "declension" — a noun's cases and plural;
  - "comparison" — an adjective's comparative/superlative;
  - "forms" — anything else that inflects;
  - "word" — open the full analysis of a DIFFERENT word you brought up (a synonym, a related word), never of the selected one.
Label them in ${nativeLanguage}, naming the word ("Спряжение aufräumen"). Return an empty list when nothing would genuinely help.

OUTPUT
Return ONLY valid JSON, no markdown:
{
  "contentParts": [
    { "type": "text", "text": "explanation in ${nativeLanguage}" },
    { "type": "learning", "text": "sentence in ${targetLanguage}", "translation": "its translation in ${nativeLanguage}" }
  ],
  "suggestions": ["short question in ${nativeLanguage}", "...", "..."],
  "actions": [{ "kind": "conjugation", "label": "Спряжение …", "word": "dictionary form" }],
  "grammarPatterns": [{ "patternId": "short-kebab-id", "patternLabel": "plain-language name of the pattern in ${nativeLanguage}" }]
}
"grammarPatterns": list the 1-3 grammar constructions you explained or relied on in this answer. Each has a stable short "patternId" (lowercase, kebab-case, language-agnostic, e.g. "v2-word-order", "perfekt-past", "separable-prefix") and a "patternLabel" in ${nativeLanguage} (e.g. "Глагол всегда на 2-м месте"). Return an empty list if no grammar concept was central to the answer.
Every ${targetLanguage} word, phrase or sentence you show MUST be its own "learning" part with a filled-in "translation" — that is what makes it tappable and speakable in the app. Never put ${targetLanguage} examples inside a "text" part. Keep "text" parts short: they are the connective tissue between examples, not paragraphs.
Do not suggest changing the learner's source text. No markdown, no bullet characters, no headings.`;
}

// ─── Reading the answer back ─────────────────────────────────────────────────

const ACTION_KINDS: DiscussActionKind[] = ["conjugation", "declension", "comparison", "forms", "word"];

function isActionKind(value: string): value is DiscussActionKind {
  return (ACTION_KINDS as string[]).includes(value);
}

const MAX_SUGGESTIONS = 4;
const MAX_SUGGESTION_CHARS = 44;
const MAX_ACTIONS = 3;

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Normalises whatever the model returned into a `DiscussMessage`.
 *
 * Written to accept a partial answer rather than reject it: a reply that was
 * cut short still has usable examples in it, and losing the suggestions is not
 * a reason to show the learner an error.
 */
export function parseDiscussReply(value: unknown, rawText: string): DiscussMessage {
  const source = (value ?? {}) as Record<string, unknown>;

  const contentParts = (Array.isArray(source.contentParts) ? source.contentParts : [])
    .map((part): DiscussContentPart | null => {
      const p = (part ?? {}) as Record<string, unknown>;
      const text = asString(p.text);
      if (!text) return null;
      const translation = asString(p.translation);
      // A part is only "learning" if it carries a translation — an untranslated
      // one renders as a gold box with an empty second line.
      if (p.type === "learning" && translation) return { type: "learning", text, translation };
      return { type: "text", text };
    })
    .filter((part): part is DiscussContentPart => part !== null);

  if (contentParts.length === 0) {
    const fallback = rawText.trim();
    return {
      role: "model",
      contentParts: [{ type: "text", text: fallback || "Не получилось разобрать ответ. Спросите ещё раз." }],
    };
  }

  const suggestions = (Array.isArray(source.suggestions) ? source.suggestions : [])
    .map(asString)
    .filter((s) => s.length > 0 && s.length <= MAX_SUGGESTION_CHARS)
    .slice(0, MAX_SUGGESTIONS);

  const actions = (Array.isArray(source.actions) ? source.actions : [])
    .map((action): DiscussAction | null => {
      const a = (action ?? {}) as Record<string, unknown>;
      const kind = asString(a.kind);
      const word = asString(a.word);
      const label = asString(a.label);
      if (!isActionKind(kind) || !word) return null;
      return { kind, label: label || word, word };
    })
    .filter((action): action is DiscussAction => action !== null)
    .slice(0, MAX_ACTIONS);

  const grammarPatterns = (Array.isArray(source.grammarPatterns) ? source.grammarPatterns : [])
    .map((gp): GrammarPattern | null => {
      const g = (gp ?? {}) as Record<string, unknown>;
      const patternId = asString(g.patternId);
      const patternLabel = asString(g.patternLabel);
      if (!patternId || !patternLabel) return null;
      return { patternId, patternLabel };
    })
    .filter((gp): gp is GrammarPattern => gp !== null)
    .slice(0, 5);

  return {
    role: "model",
    contentParts,
    ...(suggestions.length > 0 ? { suggestions } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(grammarPatterns.length > 0 ? { grammarPatterns } : {}),
  };
}
