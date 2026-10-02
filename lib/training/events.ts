// One answer given in a trainer — the shape shared by the browser that logs
// it, the route that stores it and the MCP tools that read it back.
//
// The rule that shapes the fields: what was *checked* is kept apart from how
// it was answered. Knowing a translation, an article, a verb form and using
// the word in a sentence are different knowledge, so each event names exactly
// one of them (checks), and a flashcard self-rating (outcome «self_rated» with
// self_grade) is never mistaken for an automatically checked right answer.

export const TRAINERS = ["review", "active", "nouns", "verbs", "adjectives", "prepositions"] as const;
export type Trainer = typeof TRAINERS[number];

export const OUTCOMES = ["correct", "typo", "incorrect", "dont_know", "skipped", "technical", "self_rated"] as const;
export type Outcome = typeof OUTCOMES[number];

/** What a single event tested. */
export const CHECKS = [
  "translation",
  "article",
  "plural",
  "word_with_article",
  "form",
  "conjugation",
  "sentence",
  "adjective_ending",
  "preposition_case",
  "recognition",
  "recall",
  "listening",
  "spoken_production",
] as const;
export type Check = typeof CHECKS[number];

/** The kind of knowledge a check is evidence of — what the teacher reads. */
export const KNOWLEDGE: Record<Check, "translation" | "article" | "plural" | "verb_form" | "conjugation" | "sentence_use" | "grammar_ending" | "case_government" | "card_recall"> = {
  translation: "translation",
  article: "article",
  plural: "plural",
  word_with_article: "article",
  form: "verb_form",
  conjugation: "conjugation",
  sentence: "sentence_use",
  adjective_ending: "grammar_ending",
  preposition_case: "case_government",
  recognition: "card_recall",
  recall: "card_recall",
  listening: "card_recall",
  spoken_production: "card_recall",
};

export type TrainingEvent = {
  client_event_id: string;
  occurred_at: string;
  local_date: string;
  time_zone: string;
  trainer: Trainer;
  mode: string | null;
  session_id: string | null;
  entry_id: string | null;
  card_id: string | null;
  word: string;
  checks: Check;
  form: string | null;
  pronoun: string | null;
  tense: string | null;
  prompt: string | null;
  answer: string | null;
  expected: string | null;
  outcome: Outcome;
  attempt_no: number;
  hint_used: boolean;
  answer_shown: boolean;
  self_grade: number | null;
  meta: Record<string, unknown>;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const s = String(value).trim().slice(0, max);
  return s || null;
}

/** An event from the wire, held to its shape, or null when it is unusable. */
export function normalizeEvent(raw: unknown): TrainingEvent | null {
  if (typeof raw !== "object" || raw === null) return null;
  const e = raw as Record<string, unknown>;
  const id = text(e.client_event_id, 80);
  const occurred = text(e.occurred_at, 40);
  const day = text(e.local_date, 10);
  if (!id || !occurred || !Number.isFinite(Date.parse(occurred)) || !day || !DATE.test(day)) return null;
  if (!(TRAINERS as readonly string[]).includes(String(e.trainer))) return null;
  if (!(CHECKS as readonly string[]).includes(String(e.checks))) return null;
  if (!(OUTCOMES as readonly string[]).includes(String(e.outcome))) return null;
  const grade = Number(e.self_grade);
  const attempt = Number(e.attempt_no);
  return {
    client_event_id: id,
    occurred_at: new Date(occurred).toISOString(),
    local_date: day,
    time_zone: text(e.time_zone, 60) ?? "UTC",
    trainer: e.trainer as Trainer,
    mode: text(e.mode, 40),
    session_id: text(e.session_id, 80),
    entry_id: typeof e.entry_id === "string" && UUID.test(e.entry_id) ? e.entry_id : null,
    card_id: typeof e.card_id === "string" && UUID.test(e.card_id) ? e.card_id : null,
    word: text(e.word, 200) ?? "",
    checks: e.checks as Check,
    form: text(e.form, 60),
    pronoun: text(e.pronoun, 30),
    tense: text(e.tense, 30),
    prompt: text(e.prompt, 500),
    answer: text(e.answer, 500),
    expected: text(e.expected, 500),
    outcome: e.outcome as Outcome,
    attempt_no: Number.isFinite(attempt) && attempt >= 1 ? Math.min(99, Math.round(attempt)) : 1,
    hint_used: e.hint_used === true,
    answer_shown: e.answer_shown === true,
    self_grade: e.outcome === "self_rated" && grade >= 1 && grade <= 4 ? Math.round(grade) : null,
    meta: typeof e.meta === "object" && e.meta !== null && !Array.isArray(e.meta) ? e.meta as Record<string, unknown> : {},
  };
}

/** A typed answer's verdict (lib/srs/activeTraining) as an outcome. */
export function outcomeFromVerdict(verdict: "correct" | "almost" | "wrong" | string, answer: string): Outcome {
  if (!answer.trim()) return "skipped";
  if (verdict === "correct") return "correct";
  if (verdict === "almost") return "typo";
  return "incorrect";
}

/** The learner's calendar day and time zone, read on their own device. */
export function localDay(now = new Date()): { local_date: string; time_zone: string } {
  let zone = "UTC";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { /* keep UTC */ }
  const pad = (n: number) => String(n).padStart(2, "0");
  return { local_date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, time_zone: zone };
}

/** «Today» in a given IANA zone, as YYYY-MM-DD — for a server answering «как прошёл день». */
export function dayInZone(zone: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}
