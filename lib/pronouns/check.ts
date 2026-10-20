// Checking a pronoun answer by its parts, with rules — never one verdict for
// the whole sentence, and never a language model for a short answer.
//
// The checker knows what the task asked for (subject, object, verb,
// construction), finds those parts in what the learner wrote, and judges each
// on its own: the subject, the object, whether the verb agrees with the
// subject *the learner chose*, the sentence type and word order, the
// preposition, the separable prefix, the negation, and spelling. «Er sieht
// euch» for «Они видят нас» is two wrong participants and a correctly agreed
// verb — not three errors and not one. A swap of the two roles is one error.
//
// Anything it cannot place — an unknown word, no verb at all — makes the
// answer «needs_review»: the learner is asked to clarify, or it goes to the
// teacher. An unsure check is never written down as the learner's mistake.

import { MODAL, NOUN_BY_ID, PRONOUNS, VERB_BY_ID, VERBS, type PronounId } from "./catalog";
import type { PronounTask, Role } from "./tasks";

export const COMPONENTS = ["subject", "object", "conjugation", "sentence_type", "word_order", "government", "separable_prefix", "negation", "spelling"] as const;
export type Component = typeof COMPONENTS[number];

export const COMPONENT_LABEL: Record<Component, string> = {
  subject: "Подлежащее",
  object: "Дополнение",
  conjugation: "Спряжение",
  sentence_type: "Тип предложения",
  word_order: "Порядок слов",
  government: "Управление",
  separable_prefix: "Отделяемая приставка",
  negation: "Отрицание и смысл",
  spelling: "Орфография",
};

export type ComponentVerdict = "correct" | "error" | "typo";

export type Confusion = {
  role: Role;
  expected: PronounId;
  expected_form: string;
  answered_form: string | null;
  /** person: another participant; case: right person, wrong case (wir for uns); role_swap; noun_kept: the noun was not replaced. */
  kind: "person" | "case" | "polite_case" | "role_swap" | "noun_kept" | "missing";
};

export type CheckResult = {
  outcome: "correct" | "typo" | "incorrect" | "needs_review";
  components: Partial<Record<Component, ComponentVerdict>>;
  confusions: Confusion[];
  error_kind: "role_swap" | null;
  /** Did the verb agree with the subject the learner wrote — apart from whether that subject was right. */
  agreement_ok: boolean | null;
  answered: { subject: string | null; object: string | null; verb: string | null; sentence_type: "statement" | "question" | null };
  feedback: string[];
  uncertain_reason: string | null;
};

// ─── Text ────────────────────────────────────────────────────────────────────

/** Spelling-neutral form: case, umlauts as ae/oe/ue, ß as ss. */
export function fold(s: string): string {
  return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
}

export function tokenize(answer: string): string[] {
  return answer.replace(/[.,!?;:«»"„“()]/g, " ").split(/\s+/).filter(Boolean);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** A single slip in a word long enough that one letter does not make it another word. */
function nearly(a: string, b: string): boolean {
  return b.length >= 4 && Math.abs(a.length - b.length) <= 1 && levenshtein(a, b) === 1;
}

// ─── Pronoun forms ───────────────────────────────────────────────────────────

const NOM: Record<string, PronounId[]> = { ich: ["ich"], du: ["du"], er: ["er"], es: ["es"], wir: ["wir"], ihr: ["ihr"], sie: ["sie_sg", "sie_pl", "Sie"] };
const ACC: Record<string, PronounId[]> = { mich: ["ich"], dich: ["du"], ihn: ["er"], es: ["es"], uns: ["wir"], euch: ["ihr"], sie: ["sie_sg", "sie_pl", "Sie"] };
const DAT: Record<string, PronounId[]> = { mir: ["ich"], dir: ["du"], ihm: ["er", "es"], ihnen: ["sie_pl", "Sie"] };
const ACC_ONLY = new Set(["mich", "dich", "ihn", "uns", "euch"]);

type Pron = { index: number; surface: string; folded: string };

/**
 * Which pronouns a written «sie» can be. Mid-sentence the capital is meaning
 * (Sie is polite); at the start, or from a speech recogniser that capitalises
 * as it likes, it is not.
 */
function narrowSie(ids: PronounId[], p: Pron, spoken: boolean): PronounId[] {
  if (p.folded !== "sie" || spoken || p.index === 0) return ids;
  return p.surface[0] === "S" ? ["Sie"] : ids.filter((id) => id !== "Sie");
}

function asSubject(p: Pron, spoken: boolean): { ids: PronounId[]; caseOk: boolean } {
  if (NOM[p.folded]) return { ids: narrowSie(NOM[p.folded], p, spoken), caseOk: true };
  if (ACC[p.folded]) return { ids: narrowSie(ACC[p.folded], p, spoken), caseOk: false };
  if (DAT[p.folded]) return { ids: DAT[p.folded], caseOk: false };
  return { ids: [], caseOk: false };
}

function asObject(p: Pron, spoken: boolean): { ids: PronounId[]; caseOk: boolean } {
  if (ACC[p.folded]) return { ids: narrowSie(ACC[p.folded], p, spoken), caseOk: true };
  // «ihr» in an object slot is the subject form вы (or dative ей) — a case error either way.
  if (NOM[p.folded]) return { ids: narrowSie(NOM[p.folded], p, spoken), caseOk: false };
  if (DAT[p.folded]) return { ids: DAT[p.folded], caseOk: false };
  return { ids: [], caseOk: false };
}

function isPronoun(folded: string): boolean {
  return Boolean(NOM[folded] || ACC[folded] || DAT[folded]);
}

// ─── Verb forms ──────────────────────────────────────────────────────────────

type Finite = { index: number; table: Record<string, string>; exact: boolean; joinedPrefix: boolean; lexeme: "target" | "modal" | "other"; surface: string };

function findFinite(tokens: string[], task: PronounTask): Finite | null {
  const verb = VERB_BY_ID[task.verb];
  const target = task.modal ? MODAL.present : verb.present;
  const folded = tokens.map(fold);
  const forms = (table: Record<string, string>) => Object.values(table).map(fold);
  const lexeme = task.modal ? "modal" as const : "target" as const;
  // Exact, then the separable prefix glued on (anrufe), then one slip.
  for (let i = 0; i < folded.length; i++) if (forms(target).includes(folded[i])) return { index: i, table: target, exact: true, joinedPrefix: false, lexeme, surface: tokens[i] };
  if (!task.modal && verb.prefix) {
    const glued = forms(verb.present).map((f) => fold(verb.prefix!) + f);
    for (let i = 0; i < folded.length; i++) if (glued.includes(folded[i])) return { index: i, table: target, exact: true, joinedPrefix: true, lexeme, surface: tokens[i] };
  }
  for (let i = 0; i < folded.length; i++) if (forms(target).some((f) => nearly(folded[i], f))) return { index: i, table: target, exact: false, joinedPrefix: false, lexeme, surface: tokens[i] };
  // A modal task answered without the modal: the main verb stands finite.
  if (task.modal) {
    for (let i = 0; i < folded.length; i++) if (forms(verb.present).includes(folded[i])) return { index: i, table: verb.present, exact: true, joinedPrefix: false, lexeme: "target", surface: tokens[i] };
  }
  for (const other of VERBS) {
    if (other.id === verb.id) continue;
    for (let i = 0; i < folded.length; i++) if (forms(other.present).includes(folded[i]) && !isPronoun(folded[i])) return { index: i, table: other.present, exact: true, joinedPrefix: false, lexeme: "other", surface: tokens[i] };
  }
  return null;
}

/** The persons a written finite form agrees with. */
function agreesWith(form: string, table: Record<string, string>, ids: PronounId[]): boolean {
  const f = fold(form);
  return ids.some((id) => fold(table[PRONOUNS[id].de]) === f);
}

// ─── Feedback words ──────────────────────────────────────────────────────────

function ruSubject(task: PronounTask): string {
  return PRONOUNS[task.subject].ruNom;
}

function ruObjectWord(task: PronounTask): string {
  if (task.noun) return `${NOUN_BY_ID[task.noun].de}`;
  const verb = VERB_BY_ID[task.verb];
  const o = PRONOUNS[task.object];
  return verb.ruObject === "dat" ? o.ruDat : verb.ruObject === "prep" ? o.ruPrep : o.ruAcc;
}

function nounNote(task: PronounTask): string | null {
  if (!task.noun) return null;
  const n = NOUN_BY_ID[task.noun];
  const art = n.gender === "m" ? "der" : n.gender === "f" ? "die" : n.gender === "n" ? "das" : "die (мн.)";
  return `${art} ${n.de} → ${PRONOUNS[task.object].acc}: род берётся из немецкого слова, а не из русского «${n.ru}».`;
}

// ─── Blanks (choice, gaps) ───────────────────────────────────────────────────

/** Choice and gaps: only the hidden pronouns are judged; the rest of the sentence is given. */
export function checkBlanks(task: PronounTask, answers: Partial<Record<Role, string>>): CheckResult {
  const components: CheckResult["components"] = {};
  const confusions: Confusion[] = [];
  const feedback: string[] = [];
  const startsWith = task.tokens[0].slot === "S";
  for (const role of task.blanks) {
    const raw = (answers[role] ?? "").trim();
    const expectedForm = role === "subject" ? PRONOUNS[task.subject].nom : PRONOUNS[task.object].acc;
    const caseMatters = !(role === "subject" && startsWith) && fold(expectedForm) === "sie";
    const ok = caseMatters ? raw === expectedForm : fold(raw) === fold(expectedForm);
    components[role] = ok ? "correct" : "error";
    if (ok) continue;
    const expected = role === "subject" ? task.subject : task.object;
    const p = { index: role === "subject" && startsWith ? 0 : 1, surface: raw, folded: fold(raw) };
    const read = role === "subject" ? asSubject(p, false) : asObject(p, false);
    const kind: Confusion["kind"] = !raw ? "missing"
      : fold(raw) === "sie" && fold(expectedForm) === "sie" ? "polite_case"
        : read.ids.includes(expected) ? "case" : "person";
    confusions.push({ role, expected, expected_form: expectedForm, answered_form: raw || null, kind });
    const ruWord = role === "subject" ? ruSubject(task) : ruObjectWord(task);
    if (kind === "polite_case") feedback.push(expectedForm === "Sie" ? "Вежливое Sie пишется с большой буквы." : `«${ruWord}» → sie с маленькой буквы; Sie с большой — вежливое «Вы».`);
    else if (kind === "case") feedback.push(`«${ruWord}» → ${expectedForm}: ${raw} — форма ${role === "object" ? "подлежащего, а здесь дополнение" : "дополнения, а здесь подлежащее"}.`);
    else feedback.push(`«${ruWord}» → ${expectedForm}${raw ? `, а не ${raw}` : ""}.`);
  }
  const note = nounNote(task);
  if (note && components.object === "error") feedback.push(note);
  const wrong = Object.values(components).includes("error");
  if (wrong) feedback.push(`Целиком: ${task.expected}`);
  return {
    outcome: wrong ? "incorrect" : "correct",
    components, confusions, error_kind: null, agreement_ok: null,
    answered: { subject: answers.subject ?? null, object: answers.object ?? null, verb: null, sentence_type: null },
    feedback, uncertain_reason: null,
  };
}

// ─── Full sentence (written, spoken) ─────────────────────────────────────────

export function checkSentence(task: PronounTask, answer: string, opts: { spoken?: boolean } = {}): CheckResult {
  const spoken = opts.spoken === true;
  const verb = VERB_BY_ID[task.verb];
  const tokens = tokenize(answer);
  const folded = tokens.map(fold);
  const components: CheckResult["components"] = {};
  const confusions: Confusion[] = [];
  const feedback: string[] = [];
  const used = new Set<number>();
  const fail = (reason: string): CheckResult => ({
    outcome: "needs_review", components, confusions, error_kind: null, agreement_ok: null,
    answered: { subject: null, object: null, verb: null, sentence_type: null }, feedback: [reason], uncertain_reason: reason,
  });
  if (tokens.length === 0) return fail("Пустой ответ.");

  const finite = findFinite(tokens, task);
  if (!finite) return fail("Не удалось найти в ответе глагол — проверьте, что написано целое предложение.");
  used.add(finite.index);
  const fv = finite.index;

  // ── Who is who ──
  const pron = (i: number): Pron | null => (i >= 0 && i < tokens.length && isPronoun(folded[i]) && !used.has(i) ? { index: i, surface: tokens[i], folded: folded[i] } : null);
  let subjectP: Pron | null = null;
  let objectP: Pron | null = null;
  let topicalized = false;
  const before = pron(fv - 1);
  const after = pron(fv + 1);
  if (before && ACC_ONLY.has(before.folded) && after) {
    // «Uns sehen sie»: the object fronted for emphasis, still a German statement.
    objectP = before; subjectP = after; topicalized = true;
  } else if (before) subjectP = before;
  else if (after) subjectP = after;
  if (subjectP) used.add(subjectP.index);

  const aufIndex = folded.findIndex((t, i) => i > fv && t === "auf" && !used.has(i));
  const otherPrep = folded.findIndex((t, i) => !used.has(i) && ["fuer", "an", "zu", "mit", "nach", "um"].includes(t) && t !== (verb.prefix ?? "") && isPronoun(folded[i + 1] ?? ""));
  if (!objectP) {
    if (verb.preposition && aufIndex >= 0) objectP = pron(aufIndex + 1);
    if (!objectP) {
      for (let i = 0; i < tokens.length && !objectP; i++) objectP = pron(i);
    }
  }
  if (objectP) used.add(objectP.index);
  if (aufIndex >= 0) used.add(aufIndex);
  if (otherPrep >= 0) used.add(otherPrep);

  // Pieces the construction may need.
  const nichtIndex = folded.findIndex((t) => t === "nicht" || t === "kein");
  const nichtNear = nichtIndex >= 0 ? nichtIndex : folded.findIndex((t) => t === "nich" || t === "nciht" || t === "nihct");
  if (nichtNear >= 0) used.add(nichtNear);
  const prefixIndex = verb.prefix && !task.modal ? folded.findIndex((t, i) => !used.has(i) && t === fold(verb.prefix!)) : -1;
  if (prefixIndex >= 0) used.add(prefixIndex);
  const fullInfinitive = fold(verb.infinitive);
  let infIndex = -1;
  let infExact = false;
  if (task.modal) {
    infIndex = folded.findIndex((t, i) => !used.has(i) && t === fullInfinitive);
    infExact = infIndex >= 0;
    if (infIndex < 0) infIndex = folded.findIndex((t, i) => !used.has(i) && nearly(t, fullInfinitive));
    if (infIndex >= 0) used.add(infIndex);
  }
  // A main verb left conjugated after the modal: «kann dich höre».
  const conjugatedAfterModal = task.modal && finite.lexeme === "modal" && infIndex < 0
    ? folded.findIndex((t, i) => !used.has(i) && Object.values(verb.present).map(fold).includes(t)) : -1;
  if (conjugatedAfterModal >= 0) used.add(conjugatedAfterModal);
  // Split infinitive «an rufen» after a modal.
  const splitInf = task.modal && verb.prefix && infIndex < 0
    ? folded.findIndex((t, i) => !used.has(i) && t === fold(verb.prefix!) && folded[i + 1] === fold(verb.infinitive.slice(verb.prefix!.length))) : -1;
  if (splitInf >= 0) { used.add(splitInf); used.add(splitInf + 1); }
  // A noun task answered with the noun kept: «Ich kaufe das Handy».
  let nounKept = false;
  if (task.noun) {
    const n = fold(NOUN_BY_ID[task.noun].de);
    const ni = folded.findIndex((t, i) => !used.has(i) && t === n);
    if (ni >= 0) {
      nounKept = !objectP;
      used.add(ni);
      if (ni > 0 && ["der", "die", "das", "den", "dem"].includes(folded[ni - 1])) used.add(ni - 1);
    }
  }

  const unknown = tokens.filter((_, i) => !used.has(i));
  if (unknown.length) {
    return {
      ...fail(`Проверка не знает ${unknown.length === 1 ? "слова" : "слов"} ${unknown.map((u) => `«${u}»`).join(", ")}. Исправьте ответ или отправьте его на проверку.`),
      answered: { subject: subjectP?.surface ?? null, object: objectP?.surface ?? null, verb: finite.surface, sentence_type: fv === 0 ? "question" : "statement" },
    };
  }

  // ── Subject ──
  const subjRead = subjectP ? asSubject(subjectP, spoken) : { ids: [] as PronounId[], caseOk: false };
  const subjectOk = subjectP !== null && subjRead.caseOk && subjRead.ids.includes(task.subject);
  components.subject = subjectOk ? "correct" : "error";

  // ── Object ──
  const objRead = objectP ? asObject(objectP, spoken) : { ids: [] as PronounId[], caseOk: false };
  const objectOk = objectP !== null && objRead.caseOk && objRead.ids.includes(task.object);
  components.object = objectOk ? "correct" : "error";

  const expectedObjForm = PRONOUNS[task.object].acc;
  let swap = false;
  if (!subjectOk && !objectOk && subjectP && objectP && !task.noun) {
    swap = subjRead.ids.includes(task.object) && objRead.ids.includes(task.subject);
  }
  if (swap) {
    confusions.push({ role: "subject", expected: task.subject, expected_form: PRONOUNS[task.subject].nom, answered_form: subjectP!.surface, kind: "role_swap" });
    feedback.push(`Роли перепутаны: действует «${ruSubject(task)}» → ${PRONOUNS[task.subject].nom}, а направлено на «${ruObjectWord(task)}» → ${expectedObjForm}.`);
  } else {
    if (!subjectOk) {
      const kind: Confusion["kind"] = !subjectP ? "missing"
        : subjRead.ids.includes(task.subject) && !subjRead.caseOk ? "case"
          : subjectP.folded === "sie" && fold(PRONOUNS[task.subject].nom) === "sie" ? "polite_case" : "person";
      confusions.push({ role: "subject", expected: task.subject, expected_form: PRONOUNS[task.subject].nom, answered_form: subjectP?.surface ?? null, kind });
      feedback.push(
        !subjectP ? `Нет подлежащего: «${ruSubject(task)}» → ${PRONOUNS[task.subject].nom}.`
          : kind === "case" ? `«${ruSubject(task)}» → ${PRONOUNS[task.subject].nom}: ${subjectP.surface} — форма дополнения.`
            : kind === "polite_case" ? (task.subject === "Sie" ? "Вежливое Sie пишется с большой буквы." : `«${ruSubject(task)}» → sie с маленькой буквы; Sie — вежливое «Вы».`)
              : `«${ruSubject(task)}» → ${PRONOUNS[task.subject].nom}, а не ${subjectP.surface}.`,
      );
    }
    if (!objectOk) {
      const kind: Confusion["kind"] = nounKept ? "noun_kept" : !objectP ? "missing"
        : objRead.ids.includes(task.object) && !objRead.caseOk ? "case"
          : objectP.folded === "sie" && fold(expectedObjForm) === "sie" ? "polite_case" : "person";
      confusions.push({ role: "object", expected: task.object, expected_form: expectedObjForm, answered_form: objectP?.surface ?? null, kind });
      feedback.push(
        kind === "noun_kept" ? `Существительное нужно заменить местоимением: → ${expectedObjForm}.`
          : !objectP ? `Нет дополнения: «${ruObjectWord(task)}» → ${expectedObjForm}.`
            : kind === "case" ? `«${ruObjectWord(task)}» → ${expectedObjForm}: ${objectP.surface} — форма подлежащего, а здесь дополнение.`
              : kind === "polite_case" ? (task.object === "Sie" ? "Вежливое Sie пишется с большой буквы." : `«${ruObjectWord(task)}» → sie с маленькой буквы; Sie — вежливое «Вас».`)
                : `«${ruObjectWord(task)}» → ${expectedObjForm}, а не ${objectP.surface}.`,
      );
      const note = nounNote(task);
      if (note && kind !== "missing") feedback.push(note);
    }
  }

  // ── Agreement: with the subject the learner wrote ──
  let agreement: boolean | null = null;
  if (subjectP && subjRead.ids.length) {
    agreement = agreesWith(finite.surface, finite.table, subjectOk ? [task.subject] : subjRead.ids);
    if (subjectOk) {
      const right = finite.table[PRONOUNS[task.subject].de];
      if (finite.lexeme === "other") {
        components.conjugation = "correct";
      } else if (fold(finite.surface) === fold(right) || (finite.joinedPrefix && agreesWith(finite.surface.slice(verb.prefix!.length), finite.table, [task.subject]))) {
        components.conjugation = "correct";
        agreement = true;
      } else if (!finite.exact && nearly(fold(finite.surface), fold(right))) {
        components.conjugation = "correct";
        components.spelling = "typo";
        agreement = true;
        feedback.push(`Опечатка: ${finite.surface} → ${right}.`);
      } else {
        components.conjugation = "error";
        feedback.push(`${PRONOUNS[task.subject].nom} (${ruSubject(task)}) → ${right}, а не ${finite.surface}.`);
      }
    } else {
      components.conjugation = agreement ? "correct" : "error";
      if (agreement && !swap && subjectP) feedback.push(`${cap(subjectP.surface)} ${finite.surface} согласовано правильно, но подлежащее выбрано неверно.`);
    }
  }
  if (task.modal && finite.lexeme === "modal") {
    if (conjugatedAfterModal >= 0) { components.conjugation = "error"; feedback.push(`После ${finite.surface} — инфинитив: ${verb.infinitive}.`); }
    else if (infIndex < 0 && splitInf < 0) { components.conjugation = "error"; feedback.push(`Не хватает инфинитива в конце: ${verb.infinitive}.`); }
    else if (infIndex >= 0 && !infExact) { components.spelling = "typo"; feedback.push(`Опечатка: ${tokens[infIndex]} → ${verb.infinitive}.`); }
  }

  // ── Meaning: the verb, the modal, nicht ──
  let meaningOk = true;
  if (finite.lexeme === "other") { meaningOk = false; feedback.push(`Другой глагол: нужен ${verb.infinitive} (${verb.ru}).`); }
  if (task.modal && finite.lexeme !== "modal") { meaningOk = false; feedback.push(`Пропущен модальный глагол: ${MODAL.present[PRONOUNS[task.subject].de]} … ${verb.infinitive}.`); }
  const wantNicht = task.sentenceType === "negation";
  if (wantNicht && nichtNear < 0) { meaningOk = false; feedback.push("Пропущено nicht."); }
  if (!wantNicht && nichtNear >= 0) { meaningOk = false; feedback.push("Лишнее nicht: в задании нет отрицания."); }
  if (nichtNear >= 0 && nichtIndex < 0) { components.spelling = "typo"; feedback.push(`Опечатка: ${tokens[nichtNear]} → nicht.`); }
  components.negation = meaningOk ? "correct" : "error";

  // ── Sentence type ──
  const answeredType = fv === 0 ? "question" : "statement";
  const wantQuestion = task.sentenceType === "question";
  if (wantQuestion !== (answeredType === "question")) {
    components.sentence_type = "error";
    feedback.push(wantQuestion ? "Это вопрос: спрягаемый глагол встаёт на первое место." : "Получился вопрос: в утверждении глагол стоит на втором месте.");
  } else components.sentence_type = "correct";

  // ── Government ──
  if (verb.preposition) {
    if (aufIndex >= 0 && objectP && objectP.index === aufIndex + 1) components.government = "correct";
    else {
      components.government = "error";
      feedback.push(`${verb.infinitive} ${verb.preposition} + Akkusativ: ${verb.preposition} ${expectedObjForm}.`);
    }
  } else if (otherPrep >= 0) {
    components.government = "error";
    feedback.push(`${verb.infinitive} — без предлога: прямое дополнение в Akkusativ.`);
  }

  // ── Separable prefix ──
  if (verb.prefix) {
    if (task.modal) {
      if (splitInf >= 0) { components.separable_prefix = "error"; feedback.push(`После модального глагола инфинитив пишется слитно: ${verb.infinitive}.`); }
      else if (infIndex >= 0) components.separable_prefix = "correct";
    } else if (finite.joinedPrefix) {
      components.separable_prefix = "error";
      feedback.push(`Приставка ${verb.prefix} отделяется и уходит в конец: … ${verb.prefix}.`);
    } else if (prefixIndex < 0) {
      components.separable_prefix = "error";
      feedback.push(`Пропущена приставка ${verb.prefix}: ${verb.infinitive} → … ${verb.prefix}.`);
    } else components.separable_prefix = "correct";
  }

  // ── Word order within the sentence type ──
  const orderProblems: string[] = [];
  const last = tokens.length - 1;
  if (prefixIndex >= 0 && prefixIndex !== last) orderProblems.push(`приставка ${verb.prefix} стоит в самом конце`);
  if (infIndex >= 0 && infIndex !== last) orderProblems.push(`инфинитив ${verb.infinitive} стоит в самом конце`);
  if (objectP && !topicalized && objectP.index < fv) orderProblems.push("местоимение-дополнение идёт после глагола");
  if (nichtNear >= 0 && objectP && wantNicht) {
    if (verb.preposition ? nichtNear > (aufIndex >= 0 ? aufIndex : objectP.index) : nichtNear < objectP.index && !topicalized) {
      orderProblems.push(verb.preposition ? `nicht стоит перед ${verb.preposition}` : "nicht стоит после местоимения");
    }
  }
  if (subjectP && answeredType === "question" && subjectP.index !== fv + 1) orderProblems.push("в вопросе подлежащее сразу после глагола");
  if (orderProblems.length) {
    components.word_order = "error";
    feedback.push(`Порядок слов: ${orderProblems.join("; ")}.`);
  } else components.word_order = "correct";
  if (topicalized && components.subject === "correct" && components.object === "correct") feedback.push(`Допустимый порядок слов (дополнение вынесено вперёд). Обычный вариант: ${task.expected}`);

  if (!components.spelling) components.spelling = "correct";
  const verdicts = Object.values(components);
  const outcome: CheckResult["outcome"] = verdicts.includes("error") ? "incorrect" : verdicts.includes("typo") ? "typo" : "correct";
  if (outcome !== "correct") feedback.push(`Нужно: ${task.expected}`);
  return {
    outcome, components, confusions, error_kind: swap ? "role_swap" : null, agreement_ok: agreement,
    answered: { subject: subjectP?.surface ?? null, object: objectP?.surface ?? null, verb: finite.surface, sentence_type: answeredType },
    feedback, uncertain_reason: null,
  };
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
