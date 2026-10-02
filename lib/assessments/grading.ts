// Checking answers, and summing them up by skill.
//
// Pure functions of the frozen test and the learner's answers: results are
// computed when asked for, never stored, so a teacher's review or a corrected
// rule can never leave a stale score behind.
//
// The rules the module bends around:
//  - writing «ae/oe/ue/ss» for «ä/ö/ü/ß» is not an error at all (unless the item
//    is a spelling task, focus: "spelling");
//  - a typo is not a wrong answer: it keeps half its points, is marked as
//    spelling rather than meaning, and is flagged for the teacher, because
//    "einen" for "einem" is one letter too and only a human can tell a slip from
//    a case error;
//  - «не знаю», a skipped item, a wrong answer and a technical failure (a silent
//    recording, Azure down) are four different things and are kept apart;
//  - a skipped item counts in the total score but is not evidence of a weak
//    skill: skill percentages are over attempted items, with the skipped count
//    reported beside them.

import {
  DIMENSIONS,
  SKILLS,
  allItems,
  isSpeakingType,
  itemSkill,
  needsTeacher,
  type AssessmentContent,
  type Dimension,
  type Gap,
  type Item,
  type Section,
  type Skill,
} from "./model";
import type { SpeechScores, SpeechWord, TechnicalReason } from "./azureSpeech";

export type AnswerValue = string | string[] | Record<string, string>;

export type AnswerRecord = {
  value: AnswerValue | null;
  status: "answered" | "dont_know";
  /** Unsent text the learner was typing — autosaved, not an answer yet. */
  draft?: AnswerValue | null;
  first_value: AnswerValue | null;
  first_status: "answered" | "dont_know";
  first_at: string;
  history: { value: AnswerValue | null; status: "answered" | "dont_know"; at: string }[];
  tries: number;
  updated_at: string;
};

/** A record can hold nothing but an autosaved draft; that is not an answer. */
export function isAnswered(record: AnswerRecord | undefined): boolean {
  return Boolean(record && (record.status === "dont_know" || record.value !== null));
}

/** One sent recording of a speaking item. */
export type SpeechRecording = {
  id: string;
  storage_path: string;
  duration_ms: number;
  created_at: string;
  status: "done" | "technical_error";
  technical_reason: TechnicalReason | null;
  transcript: string | null;
  scores: SpeechScores | null;
  words: SpeechWord[];
  /** Azure's answer exactly as received. */
  raw: unknown;
  analyzed_at: string | null;
};

export type SpeechItemState = { recordings: SpeechRecording[] };
export type SpeechState = Record<string, SpeechItemState>;

/** Recordings that count against max_recordings: technical failures do not. */
export function countedRecordings(state: SpeechItemState | undefined): number {
  return (state?.recordings ?? []).filter((r) => r.status === "done").length;
}

/** The recording that stands as the answer: the latest one that was analyzed. */
export function answerRecording(state: SpeechItemState | undefined): SpeechRecording | null {
  const done = (state?.recordings ?? []).filter((r) => r.status === "done");
  return done.at(-1) ?? null;
}

export type DimensionMark = "ok" | "minor" | "error";

export type TeacherItemReview = {
  item_id: string;
  score: number;
  comment: string;
  dimensions: Partial<Record<Dimension, DimensionMark>>;
  corrected: string;
};

export type TeacherReview = {
  items: TeacherItemReview[];
  summary: string;
  gaps: { topic: string; skill: Skill | null; description: string; words: string[] }[];
  reviewed_at: string;
};

export type ItemStatus =
  | "correct"
  | "partial"
  | "incorrect"
  | "dont_know"
  | "unanswered"
  | "pending_review"
  | "technical_issue";

/** What kind of shortfall a result is — kept apart on purpose. */
export type ErrorKind = "typo" | "error" | "dont_know" | "skipped" | "technical" | null;

export type SpeechResult = {
  transcript: string;
  scores: SpeechScores;
  words: SpeechWord[];
  recordings_sent: number;
  technical_failures: number;
};

export type ItemResult = {
  item_id: string;
  status: ItemStatus;
  /** null while it waits for the teacher, or after a technical failure. */
  score: number | null;
  max: number;
  error_kind: ErrorKind;
  dimensions: Partial<Record<Dimension, DimensionMark>>;
  notes: string[];
  /** Auto-check is unsure (a near miss); the teacher agent should confirm. */
  needs_teacher_check: boolean;
  /** The right answer, written out for a human. */
  expected: string;
  graded_by: "auto" | "teacher" | "none";
  teacher_comment: string;
  corrected: string;
  speech: SpeechResult | null;
};

// ─── Text comparison ─────────────────────────────────────────────────────────

/** Spacing, quotes and the final full stop are not what is being tested. */
export function normalizeAnswer(value: string): string {
  return value
    .normalize("NFC")
    .replace(/[‘’‚`´]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([,;:!?.])\s*/g, "$1 ")
    .trim()
    .replace(/[.!?;:,]+$/, "")
    .trim();
}

/** ä → ae and friends: the spelling a keyboard without umlauts produces. */
function transliterate(value: string): string {
  return value
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "Ae").replace(/Ö/g, "Oe").replace(/Ü/g, "Ue")
    .replace(/ß/g, "ss");
}

function foldAll(value: string): string {
  return transliterate(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

export type Match = "exact" | "near" | "none";

/**
 * How close a typed answer is to any accepted one.
 *
 * exact also covers «ae/oe/ue/ss» for «ä/ö/ü/ß», unless strictSpelling.
 * near = only case, or a slip of one letter (two in a long answer). With
 * tolerance off — a gap that tests an ending — only case counts as near: one
 * letter there IS the grammar.
 */
export function compareText(given: string, accepted: string[], tolerance = true, strictSpelling = false): Match {
  const g = normalizeAnswer(given);
  if (!g) return "none";
  const targets = accepted.map(normalizeAnswer).filter(Boolean);
  if (targets.includes(g)) return "exact";
  if (!strictSpelling && targets.some((t) => transliterate(t) === transliterate(g))) return "exact";
  const gf = foldAll(g);
  for (const t of targets) {
    const tf = foldAll(t);
    if (gf === tf) return "near";
    if (!tolerance) continue;
    const allowed = tf.length >= 9 ? 2 : tf.length >= 4 ? 1 : 0;
    if (allowed > 0 && editDistance(gf, tf) <= allowed) return "near";
  }
  return "none";
}

// ─── One item ────────────────────────────────────────────────────────────────

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function defaultFocus(section: Section, item: Item): Dimension {
  if (item.focus) return item.focus;
  const skill = itemSkill(section, item);
  if (skill === "grammar") return "grammar";
  if (skill === "vocabulary") return "vocabulary";
  if (skill === "speaking") return "pronunciation";
  return "meaning";
}

export function expectedAnswer(item: Item): string {
  switch (item.type) {
    case "single_choice":
      return item.options.find((o) => o.id === item.correct)?.text ?? "";
    case "multiple_choice":
      return item.options.filter((o) => item.correct.includes(o.id)).map((o) => o.text).join("; ");
    case "gap_select":
    case "gap_text":
      return item.text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, id: string) => {
        const gap = item.gaps.find((g) => g.id === id);
        return gap ? `[${gap.answer}]` : "[…]";
      });
    case "word_order":
      return item.words.join(" ");
    case "short_answer":
    case "translation":
      return item.accepted[0] ?? "";
    case "read_aloud":
    case "repeat":
      return item.text;
    case "writing":
    case "spoken_response":
      return "";
  }
}

function gapAnswers(gap: Gap): string[] {
  return [gap.answer, ...gap.accepted];
}

const TYPO_NOTE = "Похоже на опечатку: смысл верный, написание — нет.";

function speechMark(score: number | null): DimensionMark {
  if (score === null) return "minor";
  return score >= 80 ? "ok" : score >= 60 ? "minor" : "error";
}

/** Auto-check one item against one answer; the teacher review is layered on later. */
export function autoGrade(
  section: Section,
  item: Item,
  record: AnswerRecord | undefined,
  speech?: SpeechItemState,
): ItemResult {
  const base: ItemResult = {
    item_id: item.id,
    status: "unanswered",
    score: 0,
    max: item.points,
    error_kind: "skipped",
    dimensions: {},
    notes: [],
    needs_teacher_check: false,
    expected: expectedAnswer(item),
    graded_by: "auto",
    teacher_comment: "",
    corrected: "",
    speech: null,
  };
  if (record?.status === "dont_know") return { ...base, status: "dont_know", error_kind: "dont_know" };

  const focus = defaultFocus(section, item);
  const strict = focus === "spelling";
  const right = (): ItemResult => ({ ...base, status: "correct", score: item.points, error_kind: null, dimensions: { [focus]: "ok", instruction: "ok" } });
  const wrong = (): ItemResult => ({ ...base, status: "incorrect", score: 0, error_kind: "error", dimensions: { [focus]: "error" } });
  const typo = (score: number): ItemResult => ({
    ...base, status: "partial", score: round(score), error_kind: "typo", needs_teacher_check: true,
    dimensions: { [focus === "spelling" ? "meaning" : focus]: "ok", spelling: "error" }, notes: [TYPO_NOTE],
  });

  if (isSpeakingType(item.type)) {
    const recordings = speech?.recordings ?? [];
    const failures = recordings.filter((r) => r.status === "technical_error").length;
    const used = answerRecording(speech);
    if (!used) {
      if (failures > 0) {
        return { ...base, status: "technical_issue", score: null, error_kind: "technical", notes: ["Запись не удалось оценить по техническим причинам — это не учебная ошибка."] };
      }
      return base;
    }
    const result: SpeechResult = {
      transcript: used.transcript ?? "",
      scores: used.scores ?? { pronunciation: null, accuracy: null, fluency: null, completeness: null, prosody: null },
      words: used.words,
      recordings_sent: recordings.filter((r) => r.status === "done").length,
      technical_failures: failures,
    };
    const pron = result.scores.pronunciation;
    if (item.type === "spoken_response") {
      // Pronunciation is measured; the content is the teacher's to grade.
      return { ...base, status: "pending_review", score: null, error_kind: null, graded_by: "none", speech: result, dimensions: { pronunciation: speechMark(pron) } };
    }
    if (pron === null) {
      return { ...base, status: "pending_review", score: null, error_kind: null, graded_by: "none", speech: result };
    }
    const score = Math.round(item.points * (pron / 100) * 4) / 4;
    const status: ItemStatus = pron >= 85 ? "correct" : pron >= 50 ? "partial" : "incorrect";
    return {
      ...base,
      status,
      score,
      error_kind: status === "correct" ? null : "error",
      speech: result,
      dimensions: { pronunciation: speechMark(pron), ...(result.scores.completeness !== null && result.scores.completeness < 90 ? { instruction: "minor" as const } : {}) },
    };
  }

  if (!record || record.value === null) return base;
  const value = record.value;

  switch (item.type) {
    case "single_choice":
      return value === item.correct ? right() : wrong();

    case "multiple_choice": {
      const chosen = Array.isArray(value) ? value : [];
      const hits = chosen.filter((c) => item.correct.includes(c)).length;
      const misses = chosen.length - hits;
      if (hits === item.correct.length && misses === 0) return right();
      const share = Math.max(0, (hits - misses) / item.correct.length);
      if (share === 0) return wrong();
      return { ...base, status: "partial", score: round(item.points * share), error_kind: "error", dimensions: { [focus]: "error" } };
    }

    case "gap_select":
    case "gap_text": {
      const given = typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
      const per = item.points / item.gaps.length;
      let score = 0;
      let exact = 0;
      let near = 0;
      for (const gap of item.gaps) {
        const answer = String(given[gap.id] ?? "");
        const match = item.type === "gap_select"
          ? (answer === gap.answer ? "exact" : "none")
          : compareText(answer, gapAnswers(gap), item.typo_tolerance && focus !== "grammar", strict);
        if (match === "exact") { exact++; score += per; }
        if (match === "near") { near++; score += per / 2; }
      }
      if (exact === item.gaps.length) return right();
      if (exact + near === item.gaps.length) return typo(score);
      if (score === 0) return wrong();
      return {
        ...base, status: "partial", score: round(score), error_kind: "error", needs_teacher_check: near > 0,
        dimensions: { [focus]: "error", ...(near > 0 ? { spelling: "error" as const } : {}) },
      };
    }

    case "word_order": {
      const words = Array.isArray(value) ? value.map(String) : [];
      if (words.length === 0) return base;
      const sentence = words.join(" ");
      const match = compareText(sentence, [item.words.join(" "), ...item.accepted], false, strict);
      return match === "none" ? wrong() : right();
    }

    case "short_answer":
    case "translation": {
      const text = typeof value === "string" ? value : "";
      if (!text.trim()) return base;
      if (item.accepted.length > 0) {
        const match = compareText(text, item.accepted, item.type === "short_answer" ? item.typo_tolerance : true, strict);
        if (match === "exact") return right();
        if (match === "near") return typo(item.points / 2);
      }
      // A free answer worded differently from the key may still be right:
      // that is the teacher's call, not a string comparison's.
      return { ...base, status: "pending_review", score: null, error_kind: null, graded_by: "none" };
    }

    case "writing": {
      const text = typeof value === "string" ? value : "";
      if (!text.trim()) return base;
      const words = countWords(text);
      const notes: string[] = [];
      if (item.min_words && words < item.min_words) notes.push(`${words} слов при минимуме ${item.min_words}.`);
      if (item.max_words && words > item.max_words) notes.push(`${words} слов при максимуме ${item.max_words}.`);
      return { ...base, status: "pending_review", score: null, error_kind: null, graded_by: "none", notes };
    }
  }
  return base;
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** The teacher's word overrides the auto-check, item by item. */
export function applyReview(result: ItemResult, review: TeacherItemReview | undefined): ItemResult {
  if (!review) return result;
  const score = Math.max(0, Math.min(result.max, review.score));
  const status: ItemStatus = result.status === "dont_know"
    ? "dont_know"
    : score >= result.max ? "correct" : score > 0 ? "partial" : "incorrect";
  return {
    ...result,
    status,
    score: round(score),
    error_kind: result.status === "dont_know" ? "dont_know" : status === "correct" ? null : result.error_kind === "typo" ? "typo" : "error",
    dimensions: Object.keys(review.dimensions).length > 0 ? { ...result.dimensions, ...review.dimensions } : result.dimensions,
    needs_teacher_check: false,
    graded_by: "teacher",
    teacher_comment: review.comment,
    corrected: review.corrected,
  };
}

export function gradeAll(
  content: AssessmentContent,
  answers: Record<string, AnswerRecord>,
  review: TeacherReview | null,
  speech: SpeechState = {},
): ItemResult[] {
  const byItem = new Map((review?.items ?? []).map((r) => [r.item_id, r]));
  return allItems(content).map(({ section, item }) =>
    applyReview(autoGrade(section, item, answers[item.id], speech[item.id]), byItem.get(item.id)),
  );
}

/**
 * Items that wait for the teacher: answered manual items (an empty, never-sent
 * essay is not one) without a review. When this is empty an after_review test
 * has nothing left to wait for.
 */
export function pendingTeacherItems(
  content: AssessmentContent,
  answers: Record<string, AnswerRecord>,
  review: TeacherReview | null,
  speech: SpeechState = {},
): string[] {
  const reviewed = new Set((review?.items ?? []).map((r) => r.item_id));
  return gradeAll(content, answers, null, speech)
    .filter((r) => r.status === "pending_review" && !reviewed.has(r.item_id))
    .map((r) => r.item_id);
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export type SkillSummary = {
  skill: Skill;
  score: number;
  max: number;
  /** Over the items attempted; null when nothing was attempted. */
  percent: number | null;
  items: number;
  pending_review: number;
  /** Not attempted (no answer at all). Counted in totals, not in this percent. */
  skipped: number;
  dont_know: number;
  technical_issues: number;
  /** «not_done» when every item of the skill was skipped. */
  state: "graded" | "partly_pending" | "pending" | "not_done";
};

/**
 * Score by skill. Items still waiting for the teacher, skipped items and
 * technical failures are left out of the percentage, so a pending essay reads
 * as «not graded yet» and a skipped one as «not done» — not as a weak skill.
 * «Не знаю» does count: it is an answer about what the learner knows.
 */
export function summarizeSkills(content: AssessmentContent, results: ItemResult[]): SkillSummary[] {
  const byId = new Map(results.map((r) => [r.item_id, r]));
  return SKILLS.map((skill) => {
    let score = 0;
    let max = 0;
    let items = 0;
    let pending = 0;
    let skipped = 0;
    let dontKnow = 0;
    let technical = 0;
    for (const { section, item } of allItems(content)) {
      if (itemSkill(section, item) !== skill) continue;
      items++;
      const r = byId.get(item.id);
      if (!r) continue;
      if (r.status === "unanswered") { skipped++; continue; }
      if (r.status === "technical_issue") { technical++; continue; }
      if (r.score === null) { pending++; continue; }
      if (r.status === "dont_know") dontKnow++;
      score += r.score;
      max += r.max;
    }
    const state: SkillSummary["state"] = skipped === items
      ? "not_done"
      : max === 0 ? "pending" : pending > 0 ? "partly_pending" : "graded";
    return {
      skill,
      score: round(score),
      max,
      percent: max > 0 ? Math.round((score / max) * 100) : null,
      items,
      pending_review: pending,
      skipped,
      dont_know: dontKnow,
      technical_issues: technical,
      state,
    };
  }).filter((s) => s.items > 0);
}

/** How many errors of each kind — meaning, grammar, vocabulary, spelling, instruction, pronunciation. */
export function summarizeDimensions(results: ItemResult[]): Record<Dimension, { errors: number; minor: number; ok: number }> {
  const out = Object.fromEntries(DIMENSIONS.map((d) => [d, { errors: 0, minor: 0, ok: 0 }])) as Record<Dimension, { errors: number; minor: number; ok: number }>;
  for (const r of results) {
    for (const [d, mark] of Object.entries(r.dimensions) as [Dimension, DimensionMark][]) {
      if (!out[d]) continue;
      if (mark === "error") out[d].errors++;
      else if (mark === "minor") out[d].minor++;
      else out[d].ok++;
    }
  }
  return out;
}

/**
 * The overall score counts every item, skipped ones as zero — and says how
 * much of the gap is skipping, so the number is never read as pure weakness.
 */
export function totals(results: ItemResult[]) {
  const graded = results.filter((r) => r.score !== null);
  const score = round(graded.reduce((n, r) => n + (r.score ?? 0), 0));
  const max = graded.reduce((n, r) => n + r.max, 0);
  const skipped = results.filter((r) => r.status === "unanswered");
  const attempted = graded.filter((r) => r.status !== "unanswered");
  const attemptedMax = attempted.reduce((n, r) => n + r.max, 0);
  const attemptedScore = round(attempted.reduce((n, r) => n + (r.score ?? 0), 0));
  return {
    score,
    max,
    percent: max > 0 ? Math.round((score / max) * 100) : null,
    /** The same, over attempted items only. */
    percent_of_attempted: attemptedMax > 0 ? Math.round((attemptedScore / attemptedMax) * 100) : null,
    skipped_points: skipped.reduce((n, r) => n + r.max, 0),
    pending_review: results.filter((r) => r.status === "pending_review").length,
    needs_teacher_check: results.filter((r) => r.needs_teacher_check).length,
    unanswered: skipped.length,
    dont_know: results.filter((r) => r.status === "dont_know").length,
    typos: results.filter((r) => r.error_kind === "typo").length,
    technical_issues: results.filter((r) => r.status === "technical_issue").length,
  };
}

export function hasManualItems(content: AssessmentContent): boolean {
  return allItems(content).some(({ item }) => needsTeacher(item));
}
