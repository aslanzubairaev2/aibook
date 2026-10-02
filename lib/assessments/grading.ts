// Checking answers, and summing them up by skill.
//
// Pure functions of the frozen test and the learner's answers: results are
// computed when asked for, never stored, so a teacher's review or a corrected
// rule can never leave a stale score behind.
//
// The rule the whole module bends around: a typo is not a wrong answer. An
// answer that means the right thing but is misspelt keeps half its points, is
// marked as a spelling error rather than a meaning error, and is flagged for
// the teacher to confirm — because "einen" for "einem" is one letter too, and
// only a human (or the teacher agent) can tell a slip from a case error.

import {
  DIMENSIONS,
  SKILLS,
  allItems,
  itemSkill,
  needsTeacher,
  type AssessmentContent,
  type Dimension,
  type Gap,
  type Item,
  type Section,
  type Skill,
} from "./model";

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
  | "pending_review";

export type ItemResult = {
  item_id: string;
  status: ItemStatus;
  /** null while it waits for the teacher. */
  score: number | null;
  max: number;
  dimensions: Partial<Record<Dimension, DimensionMark>>;
  notes: string[];
  /** Auto-check is unsure (a near miss); the teacher agent should confirm. */
  needs_teacher_check: boolean;
  /** The right answer, written out for a human. */
  expected: string;
  graded_by: "auto" | "teacher" | "none";
  teacher_comment: string;
  corrected: string;
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

function foldUmlauts(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
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
 * near = only case, umlaut spelling (ae for ä) or a slip of one letter (two in
 * a long answer). With tolerance off — a gap that tests an ending — only case
 * and umlaut spelling count as near: one letter there IS the grammar.
 */
export function compareText(given: string, accepted: string[], tolerance = true): Match {
  const g = normalizeAnswer(given);
  if (!g) return "none";
  const targets = accepted.map(normalizeAnswer).filter(Boolean);
  if (targets.includes(g)) return "exact";
  const gf = foldUmlauts(g);
  for (const t of targets) {
    const tf = foldUmlauts(t);
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
      return item.accepted[0] ?? "";
    case "writing":
      return "";
  }
}

function gapAnswers(gap: Gap): string[] {
  return [gap.answer, ...gap.accepted];
}

/** Auto-check one item against one answer; the teacher review is layered on later. */
export function autoGrade(section: Section, item: Item, record: AnswerRecord | undefined): ItemResult {
  const base: ItemResult = {
    item_id: item.id,
    status: "unanswered",
    score: 0,
    max: item.points,
    dimensions: {},
    notes: [],
    needs_teacher_check: false,
    expected: expectedAnswer(item),
    graded_by: "auto",
    teacher_comment: "",
    corrected: "",
  };
  if (!record || record.value === null && record.status !== "dont_know") return base;
  if (record.status === "dont_know") return { ...base, status: "dont_know" };

  const focus = defaultFocus(section, item);
  const value = record.value;
  const right = (): ItemResult => ({ ...base, status: "correct", score: item.points, dimensions: { [focus]: "ok", instruction: "ok" } });
  const wrong = (): ItemResult => ({ ...base, status: "incorrect", score: 0, dimensions: { [focus]: "error" } });

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
      return { ...base, status: "partial", score: round(item.points * share), dimensions: { [focus]: "error" } };
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
          : compareText(answer, gapAnswers(gap), item.typo_tolerance && focus !== "grammar");
        if (match === "exact") { exact++; score += per; }
        if (match === "near") { near++; score += per / 2; }
      }
      if (exact === item.gaps.length) return right();
      if (exact + near === item.gaps.length) {
        return {
          ...base, status: "partial", score: round(score), needs_teacher_check: true,
          dimensions: { [focus]: "ok", spelling: "error" },
          notes: ["Похоже на опечатку: смысл верный, написание — нет."],
        };
      }
      if (score === 0) return wrong();
      return {
        ...base, status: "partial", score: round(score), needs_teacher_check: near > 0,
        dimensions: { [focus]: "error", ...(near > 0 ? { spelling: "error" as const } : {}) },
      };
    }

    case "word_order": {
      const words = Array.isArray(value) ? value.map(String) : [];
      if (words.length === 0) return base;
      const sentence = words.join(" ");
      const match = compareText(sentence, [item.words.join(" "), ...item.accepted], false);
      return match === "none" ? wrong() : right();
    }

    case "short_answer": {
      const text = typeof value === "string" ? value : "";
      if (!text.trim()) return base;
      if (item.accepted.length > 0) {
        const match = compareText(text, item.accepted, item.typo_tolerance);
        if (match === "exact") return right();
        if (match === "near") {
          return {
            ...base, status: "partial", score: round(item.points / 2), needs_teacher_check: true,
            dimensions: { [focus]: "ok", spelling: "error" },
            notes: ["Похоже на опечатку: смысл верный, написание — нет."],
          };
        }
      }
      // A free answer worded differently from the key may still be right:
      // that is the teacher's call, not a string comparison's.
      return { ...base, status: "pending_review", score: null, graded_by: "none" };
    }

    case "writing": {
      const text = typeof value === "string" ? value : "";
      if (!text.trim()) return base;
      const words = countWords(text);
      const notes: string[] = [];
      if (item.min_words && words < item.min_words) notes.push(`${words} слов при минимуме ${item.min_words}.`);
      if (item.max_words && words > item.max_words) notes.push(`${words} слов при максимуме ${item.max_words}.`);
      return { ...base, status: "pending_review", score: null, graded_by: "none", notes };
    }
  }
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
    dimensions: Object.keys(review.dimensions).length > 0 ? review.dimensions : result.dimensions,
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
): ItemResult[] {
  const byItem = new Map((review?.items ?? []).map((r) => [r.item_id, r]));
  return allItems(content).map(({ section, item }) =>
    applyReview(autoGrade(section, item, answers[item.id]), byItem.get(item.id)),
  );
}

// ─── Summaries ───────────────────────────────────────────────────────────────

export type SkillSummary = {
  skill: Skill;
  score: number;
  max: number;
  percent: number | null;
  items: number;
  pending_review: number;
};

/**
 * Score by skill: reading, listening, writing, grammar, vocabulary.
 *
 * Items still waiting for the teacher are left out of both sides of the sum,
 * so a pending essay reads as «not graded yet», not as zero. A written
 * dialogue is a writing item: nothing here claims to measure speaking.
 */
export function summarizeSkills(content: AssessmentContent, results: ItemResult[]): SkillSummary[] {
  const byId = new Map(results.map((r) => [r.item_id, r]));
  return SKILLS.map((skill) => {
    let score = 0;
    let max = 0;
    let items = 0;
    let pending = 0;
    for (const { section, item } of allItems(content)) {
      if (itemSkill(section, item) !== skill) continue;
      items++;
      const r = byId.get(item.id);
      if (!r || r.score === null) { pending++; continue; }
      score += r.score;
      max += r.max;
    }
    return { skill, score: round(score), max, percent: max > 0 ? Math.round((score / max) * 100) : null, items, pending_review: pending };
  }).filter((s) => s.items > 0);
}

/** How many errors of each kind — meaning, grammar, vocabulary, spelling, instruction. */
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

export function totals(results: ItemResult[]) {
  const graded = results.filter((r) => r.score !== null);
  const score = round(graded.reduce((n, r) => n + (r.score ?? 0), 0));
  const max = graded.reduce((n, r) => n + r.max, 0);
  return {
    score,
    max,
    percent: max > 0 ? Math.round((score / max) * 100) : null,
    pending_review: results.filter((r) => r.status === "pending_review").length,
    needs_teacher_check: results.filter((r) => r.needs_teacher_check).length,
    unanswered: results.filter((r) => r.status === "unanswered").length,
    dont_know: results.filter((r) => r.status === "dont_know").length,
  };
}

export function hasManualItems(content: AssessmentContent): boolean {
  return allItems(content).some(({ item }) => needsTeacher(item));
}
