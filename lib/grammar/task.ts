// A grammar-trainer task and the rules that check an answer to it.
//
// A task carries every word order and every wording it accepts (variants),
// each word tagged with the job it does in the sentence (subject, verb,
// preposition, determiner…). An answer is aligned with the closest variant
// word by word, and every difference is named by what it is: a wrong, missing
// or extra preposition, a determiner in the wrong case or gender, a verb in
// the wrong person, a word in the wrong place — or just a typo, which never
// counts as a grammar error. A word the rules do not know makes the answer
// «needs_review» instead of a guessed verdict: an unsure check is never the
// learner's mistake.

import {
  CASE_LABEL,
  CONTRACTIONS,
  GENDER_LABEL,
  PRONOUN_FORMS,
  fold,
  nearly,
  readDeterminer,
  tokenize,
  type Case,
  type Family,
  type Gender,
} from "./common";

export const TRAINER_IDS = ["verb_prepositions", "articles_cases"] as const;
export type TrainerId = typeof TRAINER_IDS[number];

export const MODES = ["quick", "build", "written", "spoken"] as const;
export type Mode = typeof MODES[number];
export const MODE_LABEL: Record<Mode, string> = {
  quick: "Быстрый выбор",
  build: "Сборка предложения",
  written: "Письменный перевод",
  spoken: "Голосовой перевод",
};

export type Role = "S" | "V" | "REFL" | "OBJ" | "PREP" | "DET" | "NOUN" | "NICHT" | "PREFIX" | "INF" | "FIX";

export type Tok = {
  text: string;
  role: Role;
  /** A determiner: what it has to agree with. */
  det?: { family: Family; gender: Gender; case: Case; noun: string };
  /** A personal pronoun object: its person and case. */
  pron?: { person: string; case: Case };
};

export type Variant = { tokens: Tok[]; note: string | null };

export type QuickGap = {
  /** Accepted fillings, as typed or tapped. */
  accepted: string[];
  /** What the gap stands for, for feedback: the token it replaces. */
  token: Tok;
};

export type QuickSpec = {
  /** The sentence with gaps: text pieces and gap indexes. */
  frame: ({ text: string } | { gap: number })[];
  gaps: QuickGap[];
  /** The buttons, in groups (one row per group). «—» means «без предлога». */
  keys: string[][];
  /** Shown above the sentence: «Слово: der Drucker. Используй ein.» */
  instruction: string[];
};

export type GrammarTask = {
  id: string;
  trainer: TrainerId;
  template_version: string;
  mode: Mode;
  /** The construction this task is evidence about; a repeat brings back the same key with other words. */
  key: string;
  key_label: string;
  prompt_ru: string;
  notes_ru: string[];
  /** Words the learner may need, e.g. «der Drucker» or just «Drucker». */
  word_hint: string | null;
  expected: string;
  variants: Variant[];
  quick: QuickSpec | null;
  bank: string[] | null;
  /** Every verb and noun form this task's words can take, to tell a grammar slip from an unknown word. */
  lexicon: { verbs: string[]; nouns: string[]; words: string[] };
  /** Explanations by error type, specific to this construction. */
  explain_for: Partial<Record<ErrorType, string>>;
  /** «Разбор» after the answer: the rule behind the sentence. */
  explain: string[];
  meta: Record<string, unknown>;
  repeat_of: string | null;
  delayed_review: boolean;
};

export const ERROR_TYPES = [
  "wrong_preposition", "extra_preposition", "missing_preposition",
  "case", "gender", "determiner_form", "noun_form",
  "conjugation", "word_order", "reflexive", "separable_prefix", "negation",
  "subject", "object", "missing_word", "extra_word", "typo",
] as const;
export type ErrorType = typeof ERROR_TYPES[number];

export const ERROR_LABEL: Record<ErrorType, string> = {
  wrong_preposition: "Не тот предлог",
  extra_preposition: "Лишний предлог",
  missing_preposition: "Пропущен предлог",
  case: "Падеж",
  gender: "Род / число",
  determiner_form: "Форма определителя",
  noun_form: "Форма существительного",
  conjugation: "Спряжение",
  word_order: "Порядок слов",
  reflexive: "Возвратное местоимение",
  separable_prefix: "Отделяемая приставка",
  negation: "Отрицание",
  subject: "Подлежащее",
  object: "Дополнение",
  missing_word: "Пропущено слово",
  extra_word: "Лишнее слово",
  typo: "Опечатка",
};

export type Issue = { type: ErrorType; expected: string | null; answered: string | null; message: string };

export type CheckResult = {
  outcome: "correct" | "typo" | "incorrect" | "needs_review";
  issues: Issue[];
  feedback: string[];
  /** Which accepted variant the answer was closest to; its note when it is not the main one. */
  variant: number;
  variant_note: string | null;
  uncertain_reason: string | null;
  /** The right sentence closest to what was answered. */
  correction: string;
};

export const PREPOSITIONS = new Set(["auf", "an", "ueber", "um", "fuer", "mit", "nach", "von", "zu", "bei", "aus", "in", "vor", "ohne", "gegen", "durch", "seit", "ab"]);

// ─── Classes ─────────────────────────────────────────────────────────────────

type Klass = "prep" | "det" | "pron" | "verb" | "noun" | "nicht" | "word";

function roleClass(t: Tok): Klass[] {
  switch (t.role) {
    case "PREP": return ["prep"];
    case "PREFIX": return PREPOSITIONS.has(fold(t.text)) ? ["prep"] : ["word"];
    case "DET": return ["det"];
    case "S": case "OBJ": case "REFL": return ["pron"];
    case "V": case "INF": return ["verb"];
    case "NOUN": return ["noun"];
    case "NICHT": return ["nicht"];
    default: return ["word"];
  }
}

function answerClass(word: string, task: GrammarTask): Klass[] {
  const f = fold(word);
  const out: Klass[] = [];
  if (PREPOSITIONS.has(f)) out.push("prep");
  if (readDeterminer(f).length) out.push("det");
  if (PRONOUN_FORMS.has(f)) out.push("pron");
  if (task.lexicon.verbs.includes(f)) out.push("verb");
  if (task.lexicon.nouns.includes(f)) out.push("noun");
  if (f === "nicht") out.push("nicht");
  if (task.lexicon.words.includes(f)) out.push("word");
  return out;
}

/** Spoken and written answers alike: fused forms are compared in full, «zum» as «zu dem». */
function expand(words: string[]): { words: string[]; contracted: Set<number> } {
  const out: string[] = [];
  const contracted = new Set<number>();
  for (const w of words) {
    const c = CONTRACTIONS[fold(w)];
    if (c) { contracted.add(out.length); contracted.add(out.length + 1); out.push(c[0], c[1]); } else out.push(w);
  }
  return { words: out, contracted };
}

function expandVariant(v: Variant): Tok[] {
  const out: Tok[] = [];
  for (const t of v.tokens) {
    const c = CONTRACTIONS[fold(t.text)];
    if (c && t.role === "PREP") {
      // A fused token carries both jobs: the preposition and the article it swallowed.
      out.push({ text: c[0], role: "PREP" });
      out.push({ text: c[1], role: "DET", det: t.det });
    } else out.push(t);
  }
  return out;
}

// ─── Alignment ───────────────────────────────────────────────────────────────

type Op = { kind: "match" | "sub" | "del" | "ins"; a: number; v: number };

function align(a: string[], v: Tok[], task: GrammarTask): Op[] {
  const fa = a.map(fold);
  const fv = v.map((t) => fold(t.text));
  const ca = a.map((w) => answerClass(w, task));
  const n = a.length, m = v.length;
  const INF = 1e9;
  const subCost = (i: number, j: number) => {
    if (fa[i] === fv[j]) return 0;
    if (nearly(fa[i], fv[j])) return 0.6;
    return roleClass(v[j]).some((k) => ca[i].includes(k)) ? 1 : INF;
  };
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(INF));
  d[0][0] = 0;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i > 0) d[i][j] = Math.min(d[i][j], d[i - 1][j] + 1);
      if (j > 0) d[i][j] = Math.min(d[i][j], d[i][j - 1] + 1);
      if (i > 0 && j > 0) d[i][j] = Math.min(d[i][j], d[i - 1][j - 1] + subCost(i - 1, j - 1));
    }
  }
  const ops: Op[] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + subCost(i - 1, j - 1)) {
      ops.push({ kind: fa[i - 1] === fv[j - 1] ? "match" : "sub", a: i - 1, v: j - 1 });
      i--; j--;
    } else if (j > 0 && d[i][j] === d[i][j - 1] + 1) {
      ops.push({ kind: "del", a: -1, v: j - 1 });
      j--;
    } else {
      ops.push({ kind: "ins", a: i - 1, v: -1 });
      i--;
    }
  }
  return ops.reverse();
}

// ─── Naming a difference ─────────────────────────────────────────────────────

function readingLabel(r: { case: Case; gender: Gender }): string {
  return `${CASE_LABEL[r.case]}, ${GENDER_LABEL[r.gender]}${r.gender === "pl" ? " число" : " род"}`;
}

function determinerIssue(expected: Tok, answered: string): Issue | null {
  const e = expected.det;
  const all = readDeterminer(answered);
  if (!e || all.length === 0) return null;
  // The noun beside it shows the number: «den Arzt» is not read as a dative plural.
  const sameNumber = all.filter((r) => (r.gender === "pl") === (e.gender === "pl"));
  const readings = sameNumber.length ? sameNumber : all;
  const same = readings.filter((r) => r.family === e.family);
  const exp = expected.text;
  if (same.length) {
    const byGender = same.find((x) => x.gender === e.gender);
    const byCase = same.find((x) => x.case === e.case);
    // Masculine Akkusativ is where nom and acc part ways: «ein Drucker» is the case slip; elsewhere a form
    // that fits the case but not the noun means the gender was taken wrong («zur Arzt»).
    if (byGender && (!byCase || (e.case === "acc" && e.gender === "m"))) {
      return { type: "case", expected: exp, answered, message: `«${answered}» — ${CASE_LABEL[byGender.case]}, а здесь нужен ${CASE_LABEL[e.case]}: ${exp} ${e.noun}.` };
    }
    if (byCase) {
      const r = byCase;
      return { type: "gender", expected: exp, answered, message: `«${answered}» — форма для ${r.gender === "pl" ? "множественного числа" : `рода «${GENDER_LABEL[r.gender]}»`}; ${e.noun} — ${e.gender === "pl" ? "множественное число" : `${GENDER_LABEL[e.gender]} род`}: ${exp}.` };
    }
    return { type: "determiner_form", expected: exp, answered, message: `«${answered}» — ${readingLabel(same[0])}; здесь ${CASE_LABEL[e.case]} и ${e.gender === "pl" ? "множественное число" : `${GENDER_LABEL[e.gender]} род`}: ${exp}.` };
  }
  const owners = readings.filter((r) => r.family !== "der" && r.family !== "ein" && r.family !== "kein");
  if (owners.length && e.family !== "der" && e.family !== "ein" && e.family !== "kein") {
    return { type: "determiner_form", expected: exp, answered, message: `«${answered}» — другой владелец; нужно ${exp}.` };
  }
  return { type: "determiner_form", expected: exp, answered, message: `Нужен определитель ${exp}, а не «${answered}».` };
}

const PERSON_OF: Record<string, string[]> = {
  ich: ["ich", "mich", "mir"], du: ["du", "dich", "dir"], er: ["er", "ihn", "ihm"], sie_sg: ["sie", "ihr"],
  wir: ["wir", "uns"], ihr: ["ihr", "euch"], sie_pl: ["sie", "ihnen"], Sie: ["sie", "ihnen"],
};

function substitution(t: Tok, answered: string, task: GrammarTask): Issue | null {
  const a = fold(answered);
  const v = fold(t.text);
  const cls = answerClass(answered, task);
  switch (t.role) {
    case "PREP":
      if (cls.includes("prep")) return { type: "wrong_preposition", expected: t.text, answered, message: `Предлог: нужно «${t.text}», а не «${answered}».` };
      break;
    case "PREFIX":
      if (cls.includes("prep") || cls.includes("word")) return { type: "separable_prefix", expected: t.text, answered, message: `Приставка: ${t.text}, а не ${answered}.` };
      break;
    case "DET": {
      const issue = determinerIssue(t, answered);
      if (issue) return issue;
      break;
    }
    case "OBJ":
      if (cls.includes("pron")) {
        const same = t.pron && PERSON_OF[t.pron.person]?.includes(a);
        return same
          ? { type: "case", expected: t.text, answered, message: `«${answered}» — не тот падеж: здесь ${t.pron ? CASE_LABEL[t.pron.case] : "другой падеж"} — ${t.text}.` }
          : { type: "object", expected: t.text, answered, message: `Дополнение: ${t.text}, а не ${answered}.` };
      }
      break;
    case "S":
      if (cls.includes("pron")) return { type: "subject", expected: t.text, answered, message: `Подлежащее: ${t.text}, а не ${answered}.` };
      break;
    case "REFL":
      if (cls.includes("pron")) return { type: "reflexive", expected: t.text, answered, message: `Возвратное местоимение: ${t.text}, а не ${answered}.` };
      break;
    case "V": case "INF":
      if (cls.includes("verb")) {
        return t.role === "INF"
          ? { type: "conjugation", expected: t.text, answered, message: `После модального глагола — инфинитив: ${t.text}, а не ${answered}.` }
          : { type: "conjugation", expected: t.text, answered, message: `Глагол: ${t.text}, а не ${answered}.` };
      }
      break;
    case "NOUN":
      if (cls.includes("noun")) return { type: "noun_form", expected: t.text, answered, message: `Существительное: ${t.text}, а не ${answered}.` };
      break;
    case "NICHT":
      break;
    default:
      break;
  }
  if (nearly(a, v)) return { type: "typo", expected: t.text, answered, message: `Опечатка: ${answered} → ${t.text}.` };
  return null;
}

function missing(t: Tok): Issue {
  switch (t.role) {
    case "PREP": return { type: "missing_preposition", expected: t.text, answered: null, message: `Пропущен предлог «${t.text}».` };
    case "DET": return { type: "determiner_form", expected: t.text, answered: null, message: `Пропущен определитель: ${t.text}.` };
    case "REFL": return { type: "reflexive", expected: t.text, answered: null, message: `Пропущено возвратное местоимение ${t.text}.` };
    case "PREFIX": return { type: "separable_prefix", expected: t.text, answered: null, message: `Пропущена приставка ${t.text} — она уходит в конец.` };
    case "NICHT": return { type: "negation", expected: "nicht", answered: null, message: "Пропущено nicht." };
    case "INF": return { type: "conjugation", expected: t.text, answered: null, message: `Не хватает инфинитива в конце: ${t.text}.` };
    default: return { type: "missing_word", expected: t.text, answered: null, message: `Пропущено слово «${t.text}».` };
  }
}

function extra(answered: string, task: GrammarTask): Issue | "unknown" {
  const cls = answerClass(answered, task);
  if (cls.includes("prep")) return { type: "extra_preposition", expected: null, answered, message: `Лишний предлог «${answered}»: здесь без предлога.` };
  if (cls.includes("nicht")) return { type: "negation", expected: null, answered, message: "Лишнее nicht: в задании нет отрицания." };
  if (cls.includes("det")) return { type: "determiner_form", expected: null, answered, message: `Лишний определитель «${answered}».` };
  if (cls.length) return { type: "extra_word", expected: null, answered, message: `Лишнее слово «${answered}».` };
  return "unknown";
}

// ─── Sentence answers (build, written, spoken) ───────────────────────────────

type Attempt = { variant: number; issues: Issue[]; unknown: string[]; uncontracted: string[] };

/**
 * Written answers only: the capital is meaning in «Sie» and «Ihr» (вежливо)
 * versus «sie» and «ihr» (она, они, её, их) — anywhere but the first word.
 */
function politeCase(t: Tok, answered: string, index: number): Issue | null {
  if (index === 0) return null;
  const want = t.text[0];
  const got = answered[0];
  if (want === got || fold(t.text) !== fold(answered)) return null;
  const polite = want === want.toUpperCase();
  if (t.role === "S" && fold(t.text) === "sie") {
    return { type: "subject", expected: t.text, answered, message: polite ? "Вежливое Sie («Вы») пишется с большой буквы." : "sie («она», «они») пишется с маленькой буквы; Sie с большой — вежливое «Вы»." };
  }
  if (t.role === "DET" && t.det && (t.det.family === "Ihr" || t.det.family === "ihr")) {
    return { type: "determiner_form", expected: t.text, answered, message: polite ? `Вежливое ${t.text} («Ваш») пишется с большой буквы.` : `${t.text} («её», «их») пишется с маленькой буквы; ${answered} с большой — вежливое «Ваш».` };
  }
  return null;
}

function attempt(task: GrammarTask, words: string[], contracted: Set<number>, vi: number, spoken: boolean): Attempt {
  const v = expandVariant(task.variants[vi]);
  const ops = align(words, v, task);
  const issues: Issue[] = [];
  const unknown: string[] = [];
  const dels = ops.filter((o) => o.kind === "del");
  const inss = ops.filter((o) => o.kind === "ins");
  const usedDel = new Set<Op>();
  const usedIns = new Set<Op>();
  let moved = false;

  // A word that is missing in one place and extra in another was moved.
  for (const d of dels) {
    const i = inss.find((x) => !usedIns.has(x) && fold(words[x.a]) === fold(v[d.v].text));
    if (i) { usedDel.add(d); usedIns.add(i); moved = true; }
  }
  // A missing preposition / determiner / pronoun and an extra one of the same kind elsewhere: one wrong word, also out of place.
  for (const d of dels) {
    if (usedDel.has(d)) continue;
    const i = inss.find((x) => !usedIns.has(x) && roleClass(v[d.v]).some((k) => answerClass(words[x.a], task).includes(k)));
    if (!i) continue;
    const issue = substitution(v[d.v], words[i.a], task);
    if (!issue) continue;
    usedDel.add(d); usedIns.add(i);
    issues.push(issue);
    moved = true;
  }
  for (const o of ops) {
    if (o.kind === "match") {
      const issue = spoken ? null : politeCase(v[o.v], words[o.a], o.a);
      if (issue) issues.push(issue);
    } else if (o.kind === "sub") {
      const issue = substitution(v[o.v], words[o.a], task);
      if (issue) issues.push(issue);
      else if (answerClass(words[o.a], task).length === 0) unknown.push(words[o.a]);
      else issues.push({ type: "missing_word", expected: v[o.v].text, answered: words[o.a], message: `Нужно «${v[o.v].text}», а не «${words[o.a]}».` });
    } else if (o.kind === "del" && !usedDel.has(o)) {
      issues.push(missing(v[o.v]));
    } else if (o.kind === "ins" && !usedIns.has(o)) {
      const e = extra(words[o.a], task);
      if (e === "unknown") unknown.push(words[o.a]);
      else issues.push(e);
    }
  }
  if (moved) issues.push({ type: "word_order", expected: null, answered: null, message: "Порядок слов не тот." });
  // The canonical text fused «zu dem» into «zum»; the answer wrote it out.
  const uncontracted: string[] = [];
  task.variants[vi].tokens.forEach((t) => {
    const c = CONTRACTIONS[fold(t.text)];
    if (!c || t.role !== "PREP") return;
    const at = words.findIndex((w, k) => fold(w) === c[0] && fold(words[k + 1] ?? "") === c[1] && !contracted.has(k));
    if (at >= 0) uncontracted.push(`${c[0]} ${c[1]} → ${t.text}`);
  });
  return { variant: vi, issues, unknown, uncontracted };
}

function score(a: Attempt): number {
  return a.unknown.length * 3 + a.issues.filter((i) => i.type !== "typo").length * 2 + a.issues.filter((i) => i.type === "typo").length * 0.5;
}

function variantText(v: Variant): string {
  const words = v.tokens.map((t) => t.text);
  return words.join(" ");
}

export function sentenceText(v: Variant, question: boolean): string {
  const s = variantText(v);
  return `${s[0].toUpperCase()}${s.slice(1)}${question ? "?" : "."}`;
}

export function checkSentence(task: GrammarTask, answer: string, opts: { spoken?: boolean } = {}): CheckResult {
  const raw = tokenize(answer);
  const question = task.expected.trim().endsWith("?");
  if (raw.length === 0) {
    return { outcome: "needs_review", issues: [], feedback: ["Пустой ответ."], variant: 0, variant_note: null, uncertain_reason: "Пустой ответ.", correction: task.expected };
  }
  const { words, contracted } = expand(raw);
  const tries = task.variants.map((_, i) => attempt(task, words, contracted, i, opts.spoken === true));
  const best = tries.reduce((a, b) => (score(b) < score(a) ? b : a));
  const correction = sentenceText(task.variants[best.variant], question);

  if (best.unknown.length) {
    const reason = opts.spoken
      ? `Распознано: «${answer}». Слова ${best.unknown.map((u) => `«${u}»`).join(", ")} проверка не узнаёт — возможно, это сбой распознавания. Повторите или ответьте текстом.`
      : `Проверка не знает ${best.unknown.length === 1 ? "слова" : "слов"} ${best.unknown.map((u) => `«${u}»`).join(", ")}. Исправьте ответ или отправьте его на проверку.`;
    return { outcome: "needs_review", issues: best.issues, feedback: [reason], variant: best.variant, variant_note: null, uncertain_reason: reason, correction };
  }

  // Speech: a word too many or too few outside the construction is more likely the recogniser than the learner.
  if (opts.spoken && best.issues.some((i) => i.type === "extra_word" || i.type === "missing_word")) {
    const reason = `Распознано: «${answer}». Похоже на сбой распознавания (лишнее или пропущенное слово) — повторите или ответьте текстом.`;
    return { outcome: "needs_review", issues: best.issues, feedback: [reason], variant: best.variant, variant_note: null, uncertain_reason: reason, correction };
  }
  const grammar = best.issues.filter((i) => i.type !== "typo");
  // Speech: a recogniser's near-miss is not a typo the learner made.
  const typos = opts.spoken ? [] : best.issues.filter((i) => i.type === "typo");
  const outcome: CheckResult["outcome"] = grammar.length ? "incorrect" : typos.length ? "typo" : "correct";
  const feedback: string[] = [];
  for (const issue of [...grammar, ...typos]) if (!feedback.includes(issue.message)) feedback.push(issue.message);
  const types = new Set(grammar.map((i) => i.type));
  for (const t of types) {
    const extraLine = task.explain_for[t];
    if (extraLine && !feedback.includes(extraLine)) feedback.push(extraLine);
  }
  if (!grammar.length && best.uncontracted.length) feedback.push(`Так тоже верно; обычно сливают: ${best.uncontracted.join(", ")}.`);
  const note = task.variants[best.variant].note;
  if (!grammar.length && note) feedback.push(note);
  return {
    outcome,
    issues: [...grammar, ...typos],
    feedback,
    variant: best.variant,
    variant_note: note,
    uncertain_reason: null,
    correction,
  };
}

// ─── Quick answers ───────────────────────────────────────────────────────────

/** One quick gap: «Ihren» and «ihren» are different owners, so the capital counts there. */
export function quickGapOk(gap: QuickGap, value: string): boolean {
  const a = (value ?? "").trim();
  return gap.accepted.some((x) => (fold(x).startsWith("ihr") ? x === a : fold(x) === fold(a)));
}

/** Quick mode: each gap judged on its own; «—» is «без предлога». */
export function checkQuick(task: GrammarTask, answers: string[]): CheckResult {
  const q = task.quick!;
  const issues: Issue[] = [];
  q.gaps.forEach((gap, i) => {
    const a = (answers[i] ?? "").trim();
    if (quickGapOk(gap, a)) return;
    const t = gap.token;
    if (t.role === "PREP" || (t.role === "FIX" && gap.accepted.includes("—"))) {
      if (gap.accepted.includes("—")) issues.push({ type: "extra_preposition", expected: null, answered: a, message: `Здесь без предлога: «${a}» лишний.` });
      else if (a === "—" || !a) issues.push({ type: "missing_preposition", expected: t.text, answered: null, message: `Нужен предлог «${t.text}».` });
      else issues.push({ type: "wrong_preposition", expected: t.text, answered: a, message: `Предлог: нужно «${t.text}», а не «${a}».` });
      return;
    }
    const issue = t.role === "DET" ? determinerIssue(t, a) : null;
    issues.push(issue ?? { type: "determiner_form", expected: t.text, answered: a || null, message: `Нужно ${t.text}${a ? `, а не ${a}` : ""}.` });
  });
  const feedback = issues.map((i) => i.message);
  for (const t of new Set(issues.map((i) => i.type))) {
    const line = task.explain_for[t];
    if (line && !feedback.includes(line)) feedback.push(line);
  }
  return {
    outcome: issues.length ? "incorrect" : "correct",
    issues,
    feedback,
    variant: 0,
    variant_note: null,
    uncertain_reason: null,
    correction: task.expected,
  };
}
