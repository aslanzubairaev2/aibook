// «Как сегодня прошли артикли и спряжения?» — answered from events, not from
// the state of the deck.
//
// Pure: the MCP tool reads the rows, this turns them into numbers, so every
// count can be tested exactly. Definitions the teacher can rely on:
//  - an item is one thing asked about one word: its article, its Perfekt
//    form, «du» in Präsens… (word + checks + form + pronoun + tense);
//  - first try = the first event for that item in a session (attempt_no 1);
//  - checked = an answer the app judged (not a self-rating, not skipped, not
//    a technical failure); typos are reported apart from wrong answers;
//  - corrected after an error = an item answered wrong and later right within
//    the period;
//  - flashcard self-ratings are counted on their own and never as correct.

import { KNOWLEDGE, type Check, type TrainingEvent } from "./events";

export type StoredEvent = TrainingEvent & { id?: string };

const JUDGED = new Set(["correct", "typo", "incorrect"]);

export function itemKey(e: Pick<TrainingEvent, "word" | "checks" | "form" | "pronoun" | "tense">): string {
  return [e.word.toLocaleLowerCase(), e.checks, e.form ?? "", e.pronoun ?? "", e.tense ?? ""].join("|");
}

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

type Counts = {
  tasks: number;
  checked: number;
  correct: number;
  typos: number;
  incorrect: number;
  dont_know: number;
  skipped: number;
  technical: number;
  first_try_checked: number;
  first_try_correct: number;
  hints_used: number;
  answers_shown: number;
  words: Set<string>;
};

function emptyCounts(): Counts {
  return {
    tasks: 0, checked: 0, correct: 0, typos: 0, incorrect: 0, dont_know: 0, skipped: 0, technical: 0,
    first_try_checked: 0, first_try_correct: 0, hints_used: 0, answers_shown: 0, words: new Set(),
  };
}

function add(c: Counts, e: StoredEvent) {
  c.tasks++;
  if (e.word) c.words.add(e.word.toLocaleLowerCase());
  if (e.hint_used) c.hints_used++;
  if (e.answer_shown) c.answers_shown++;
  if (e.outcome === "dont_know") c.dont_know++;
  if (e.outcome === "skipped") c.skipped++;
  if (e.outcome === "technical") c.technical++;
  if (!JUDGED.has(e.outcome)) return;
  c.checked++;
  if (e.outcome === "correct") c.correct++;
  if (e.outcome === "typo") c.typos++;
  if (e.outcome === "incorrect") c.incorrect++;
  if (e.attempt_no === 1) {
    c.first_try_checked++;
    // A hint or a peek at the answer makes a «right» answer not a first-try success.
    if (e.outcome === "correct" && !e.hint_used && !e.answer_shown) c.first_try_correct++;
  }
}

function report(c: Counts) {
  return {
    tasks: c.tasks,
    unique_words: c.words.size,
    checked_answers: c.checked,
    correct: c.correct,
    typos: c.typos,
    incorrect: c.incorrect,
    dont_know: c.dont_know,
    skipped: c.skipped,
    technical_errors: c.technical,
    accuracy_percent: pct(c.correct, c.checked),
    first_try_checked: c.first_try_checked,
    first_try_correct: c.first_try_correct,
    first_try_accuracy_percent: pct(c.first_try_correct, c.first_try_checked),
    hints_used: c.hints_used,
    answers_shown: c.answers_shown,
  };
}

export function summarizeTraining(events: StoredEvent[], period: { from: string; to: string; time_zone: string }) {
  const sorted = [...events].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const total = emptyCounts();
  const byTrainer = new Map<string, Counts>();
  const byCheck = new Map<string, Counts>();
  const byDay = new Map<string, Counts>();
  const selfRated = { count: 0, grades: { 1: 0, 2: 0, 3: 0, 4: 0 } as Record<number, number>, words: new Set<string>() };

  // Per item: its history, to find corrections and repeated errors.
  const items = new Map<string, StoredEvent[]>();

  for (const e of sorted) {
    if (e.outcome === "self_rated") {
      selfRated.count++;
      if (e.self_grade) selfRated.grades[e.self_grade]++;
      if (e.word) selfRated.words.add(e.word.toLocaleLowerCase());
      continue;
    }
    add(total, e);
    for (const [map, key] of [[byTrainer, e.trainer], [byCheck, e.checks], [byDay, e.local_date]] as const) {
      if (!map.has(key)) map.set(key, emptyCounts());
      add(map.get(key)!, e);
    }
    const k = itemKey(e);
    if (!items.has(k)) items.set(k, []);
    items.get(k)!.push(e);
  }

  let corrected = 0;
  const repeated: { word: string; checks: Check; form: string | null; pronoun: string | null; tense: string | null; wrong_times: number; expected: string | null; answers: string[]; fixed_later: boolean }[] = [];
  for (const history of items.values()) {
    const wrongIndex = history.findIndex((e) => e.outcome === "incorrect" || e.outcome === "dont_know");
    const fixed = wrongIndex >= 0 && history.slice(wrongIndex + 1).some((e) => e.outcome === "correct");
    if (fixed) corrected++;
    const wrong = history.filter((e) => e.outcome === "incorrect" || e.outcome === "dont_know");
    if (wrong.length >= 2) {
      const e = history[0];
      repeated.push({
        word: e.word, checks: e.checks, form: e.form, pronoun: e.pronoun, tense: e.tense,
        wrong_times: wrong.length, expected: e.expected,
        answers: wrong.map((w) => w.answer ?? (w.outcome === "dont_know" ? "«не знаю»" : "—")).slice(0, 5),
        fixed_later: fixed,
      });
    }
  }

  const errorsOf = (check: Check | Check[]) => {
    const checks = Array.isArray(check) ? check : [check];
    return sorted
      .filter((e) => checks.includes(e.checks) && (e.outcome === "incorrect" || e.outcome === "typo" || e.outcome === "dont_know"))
      .map((e) => ({
        word: e.word,
        form: e.form,
        pronoun: e.pronoun,
        tense: e.tense,
        expected: e.expected,
        answer: e.outcome === "dont_know" ? null : e.answer,
        outcome: e.outcome,
        first_try: e.attempt_no === 1,
        at: e.occurred_at,
      }));
  };

  // Per word, per kind of knowledge: what this word's evidence actually says.
  const profiles = new Map<string, Record<string, { right: number; wrong: number; typos: number }>>();
  for (const e of sorted) {
    if (!JUDGED.has(e.outcome) && e.outcome !== "dont_know") continue;
    const word = e.word.toLocaleLowerCase();
    if (!word) continue;
    const kind = KNOWLEDGE[e.checks];
    const profile = profiles.get(word) ?? {};
    const slot = profile[kind] ?? { right: 0, wrong: 0, typos: 0 };
    if (e.outcome === "correct") slot.right++;
    else if (e.outcome === "typo") slot.typos++;
    else slot.wrong++;
    profile[kind] = slot;
    profiles.set(word, profile);
  }

  return {
    period,
    totals: { ...report(total), corrected_after_error: corrected },
    by_trainer: Object.fromEntries([...byTrainer].map(([k, c]) => [k, report(c)])),
    by_check: Object.fromEntries([...byCheck].map(([k, c]) => [k, report(c)])),
    flashcard_self_ratings: {
      count: selfRated.count,
      unique_words: selfRated.words.size,
      grades: { forgot: selfRated.grades[1], hard: selfRated.grades[2], good: selfRated.grades[3], easy: selfRated.grades[4] },
      note: "Self-ratings in «Повторение»: the learner's own judgement, never counted as checked correct answers.",
    },
    difficult: {
      articles: errorsOf(["article", "word_with_article"]),
      plurals: errorsOf("plural"),
      verb_forms: errorsOf("form"),
      conjugations: errorsOf("conjugation"),
      adjective_endings: errorsOf("adjective_ending"),
      preposition_cases: errorsOf("preposition_case"),
      translations: errorsOf("translation"),
    },
    repeated_errors: repeated.sort((a, b) => b.wrong_times - a.wrong_times).slice(0, 30),
    trend_by_day: [...byDay].sort(([a], [b]) => a.localeCompare(b)).map(([day, c]) => ({
      day, tasks: c.tasks, checked: c.checked,
      accuracy_percent: pct(c.correct, c.checked),
      first_try_accuracy_percent: pct(c.first_try_correct, c.first_try_checked),
    })),
    word_knowledge: [...profiles].slice(0, 80).map(([word, kinds]) => ({ word, ...kinds })),
  };
}
