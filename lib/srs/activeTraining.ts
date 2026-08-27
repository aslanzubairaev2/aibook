import type { Flashcard, ProductiveSkill, SkillProgress } from "@/lib/types";
import { calculateSM2, createDefaultSkillProgress, type SrsScore } from "@/lib/srs/sm2";

export const PRODUCTIVE_SKILLS: ProductiveSkill[] = ["recall", "listen", "produce"];

/** Default number of exercises in one active session. */
export const SESSION_CAP = 18;

export type ActiveItem = { card: Flashcard; skill: ProductiveSkill };

function endOfTodayMs(now: Date): number {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/** A skill enters today's session when it is new or its due date has arrived. */
export function isSkillDue(progress: SkillProgress | undefined, now = new Date()): boolean {
  if (!progress || progress.status === "new") return true;
  const due = Date.parse(progress.dueAt);
  return !Number.isFinite(due) || due <= endOfTodayMs(now);
}

/**
 * How many exercises a single card may contribute to one session. With a large
 * deck every card gets one exercise, so no word ever comes up twice; only a
 * small deck repeats a word, and then it is spread across the whole session.
 */
export function exercisesPerCard(cardCount: number, cap = SESSION_CAP): number {
  if (cardCount <= 0) return 0;
  return Math.max(1, Math.min(PRODUCTIVE_SKILLS.length, Math.ceil(cap / cardCount)));
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type BuildQueueOptions = {
  cap?: number;
  now?: Date;
  random?: () => number;
};

/**
 * Builds a session that never asks about the same word twice in a row.
 *
 * Cards are dealt round-robin: every other due word gets its turn before a word
 * comes back for its second skill. Within a card the least-practised skill goes
 * first, and the starting skill rotates from card to card so a session does not
 * open with three identical-looking exercises.
 */
export function buildActiveQueue(
  cards: Flashcard[],
  skillsOf: (cardId: string) => Partial<Record<ProductiveSkill, SkillProgress>>,
  options: BuildQueueOptions = {},
): ActiveItem[] {
  const { cap = SESSION_CAP, now = new Date(), random = Math.random } = options;

  const perCard: ActiveItem[][] = [];
  shuffled(cards, random).forEach((card, cardIndex) => {
    const state = skillsOf(card.id);
    const due = PRODUCTIVE_SKILLS.filter((skill) => isSkillDue(state[skill], now));
    if (!due.length) return;

    const offset = cardIndex % PRODUCTIVE_SKILLS.length;
    const ordered = due
      .map((skill) => ({
        skill,
        // Weakest track first, then rotate the entry point per card.
        repetitions: state[skill]?.repetitions ?? 0,
        rotation: (PRODUCTIVE_SKILLS.indexOf(skill) - offset + PRODUCTIVE_SKILLS.length) % PRODUCTIVE_SKILLS.length,
      }))
      .sort((a, b) => a.repetitions - b.repetitions || a.rotation - b.rotation)
      .map(({ skill }) => ({ card, skill }));

    perCard.push(ordered);
  });

  const limit = exercisesPerCard(perCard.length, cap);
  const out: ActiveItem[] = [];
  for (let round = 0; round < limit && out.length < cap; round++) {
    for (const items of perCard) {
      if (round >= items.length) continue;
      out.push(items[round]);
      if (out.length >= cap) break;
    }
  }
  return out;
}

// ─── Answer checking ────────────────────────────────────────────────────────

const ARTICLES = new Set([
  "der", "die", "das", "den", "dem", "des", "ein", "eine", "einen", "einem", "einer", "eines",
  "the", "a", "an",
  "le", "la", "les", "un", "une", "des",
  "el", "los", "las", "una", "unos", "unas",
  "il", "lo", "gli", "una",
  "het", "de",
]);

/** Case, punctuation and spacing never decide whether an answer is right. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?;:"'»«„“()\[\]\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Folds umlauts and accents so a missing "ö" is a hint, not a failure. */
export function foldDiacritics(text: string): string {
  return text
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function words(text: string): string[] {
  return text ? text.split(" ") : [];
}

function stripArticle(text: string): string {
  const parts = words(text);
  if (parts.length > 1 && ARTICLES.has(parts[0])) return parts.slice(1).join(" ");
  return text;
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** A short word tolerates one slip, a long one two. */
function typoBudget(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return 2;
}

export type AnswerVerdict = "correct" | "almost" | "wrong";

export type AnswerCheck = {
  verdict: AnswerVerdict;
  /** Short reason shown to the learner when the answer was not exact. */
  hint?: string;
};

/**
 * Grades a typed answer against the expected form.
 *
 * "almost" exists so the learner is never told they are wrong over a typo, a
 * missing umlaut or a dropped article — those cases explain themselves and let
 * the learner decide whether it counts.
 */
export function checkTypedAnswer(input: string, expected: string): AnswerCheck {
  const given = normalizeAnswer(input);
  const want = normalizeAnswer(expected);
  if (!given) return { verdict: "wrong" };
  if (given === want) return { verdict: "correct" };

  const givenFolded = foldDiacritics(given);
  const wantFolded = foldDiacritics(want);
  if (givenFolded === wantFolded) {
    return { verdict: "correct", hint: `Обратите внимание на написание: ${expected.trim()}` };
  }

  const wantArticle = words(want).length > 1 && ARTICLES.has(words(want)[0]) ? words(expected.trim())[0] : null;
  const givenBare = stripArticle(givenFolded);
  const wantBare = stripArticle(wantFolded);
  if (givenBare === wantBare) {
    return {
      verdict: "almost",
      hint: wantArticle ? `Не забывайте артикль: ${wantArticle}` : "Артикль лишний",
    };
  }

  const distance = levenshtein(givenBare, wantBare);
  if (distance > 0 && distance <= typoBudget(wantBare.length)) {
    return { verdict: "almost", hint: "Похоже на опечатку" };
  }

  return { verdict: "wrong" };
}

export type DiffSegment = { text: string; changed: boolean };

/**
 * Points at exactly the letters that separate what the learner typed from the
 * correct answer — the missing "c" in "geschickt", the umlaut left off "schön"
 * — instead of leaving them to compare two words by eye and guess. Alignment
 * runs case-insensitively (a longest-common-subsequence match), but every
 * returned segment carries `expected`'s own original characters, so accents
 * and capitalisation still display exactly as they should be written.
 */
export function diffExpected(given: string, expected: string): DiffSegment[] {
  const a = given.trim().toLowerCase();
  const b = expected;
  const bLower = b.toLowerCase();
  const n = a.length;
  const m = b.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      dp[i][j] = a[i - 1] === bLower[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  // Backtrack once to mark which of `expected`'s characters took part in the
  // match — anything left over is what actually differs.
  const matched = new Array<boolean>(m).fill(false);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === bLower[j - 1]) {
      matched[j - 1] = true;
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const segments: DiffSegment[] = [];
  for (let k = 0; k < m; k++) {
    const changed = !matched[k];
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += b[k];
    else segments.push({ text: b[k], changed });
  }
  return segments;
}

// ─── Schedule preview ───────────────────────────────────────────────────────

/** Days until the next review if the learner picks this grade — shown on the buttons. */
/**
 * Whether revealing the answer should play it.
 *
 * A listening exercise already played the word — that audio was the question.
 * Playing it again the moment the learner has written down what they heard
 * tells them nothing they did not just prove they knew, so it stays silent and
 * leaves the replay to the button beside the answer. The other two exercises
 * cue from written text, so this is the first time the word is heard: after
 * writing it, that is the pronunciation they could not check any other way,
 * and after saying it aloud, it is the model to compare their own attempt to.
 */
export function shouldSpeakOnReveal(skill: ProductiveSkill): boolean {
  return skill !== "listen";
}

export function previewIntervalDays(score: SrsScore, progress?: SkillProgress): number {
  const prev = progress ?? createDefaultSkillProgress();
  return calculateSM2(score, prev.repetitions, prev.lapses, prev.intervalDays, prev.easeFactor).intervalDays;
}

/** "сегодня" / "завтра" / "через N дн." — a plain answer to "what does this button do?". */
export function formatInterval(days: number): string {
  if (days <= 0) return "сегодня";
  if (days === 1) return "завтра";
  return `через ${days} дн.`;
}
