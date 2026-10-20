"use client";

import { useEffect, useRef, useState } from "react";
import { logTrainingEvent, newId, outcomeFromVerdict } from "@/lib/training/client";
import { ArrowLeft, Eye, EyeOff, Loader2, RotateCcw } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { diffExpected, type AnswerVerdict } from "@/lib/srs/activeTraining";
import { fetchGrammar } from "@/lib/ai/grammar";
import { makeGrammarCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalGrammar, getLocalVerbConjugation, saveLocalGrammar, saveLocalVerbConjugation, type StoredConjugationRow } from "@/lib/db/local";
import { CONJUGATION_TENSE_LABEL, QUIZ_MODE_LABEL, type ConjugationTense, type QuizMode } from "@/lib/verbsQuizModes";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { DictateButton, type DictateButtonHandle } from "@/components/discover/DictateButton";
import { toRows } from "@/components/word-modal/GrammarModal";
import { classifyGermanVerb, getPresentSeparableSuffix, isPresentPluralInfinitive, type GermanVerbClass } from "@/lib/verbForms";
import { checkAgainstAlternatives, conjugateGermanLocally, GERMAN_PERSONS, keyPersons } from "@/lib/verbConjugation";
import { drillKeysFor, type DrillKey } from "@/lib/srs/drillSchedule";
import { VerbPhraseTutor } from "@/components/verbs/VerbPhraseTutor";

type Props = {
  verbs: DictionaryEntry[];
  targetLanguage: string;
  nativeLanguage: string;
  modes: Set<QuizMode>;
  conjugationTenses: Set<ConjugationTense>;
  /** Only these drills per verb (the due ones); a verb missing here gets every switched-on drill. */
  drillsByEntry?: Record<string, DrillKey[]>;
  /** Ask all six persons instead of only the ones where this verb can differ. */
  allPersons?: boolean;
  onExit: () => void;
  /** Reports one answered step so the pack's coverage bar and that drill's schedule can move. */
  onRecord?: (entryId: string, correct: boolean, drill: DrillKey, recalled: boolean) => void;
  /** Marks a word complete for the current local day after all its steps pass. */
  onComplete?: (entryId: string) => void;
};

/**
 * `expected` may hold alternatives as «habe geschwommen / bin geschwommen»
 * (verbs that take either auxiliary) — any one of them is right.
 */
type QuizField = { key: string; label: string; expected: string; locked?: boolean; suffix?: string };
type FieldResult = { verdict: AnswerVerdict; expected: string; hint?: string };

// 1sg, 2sg, 3sg, 1pl, 2pl, 3pl — the fixed person order the grammar prompt
// always uses, so the full matrix's rows (which give a whole phrase, not a
// separate pronoun field like the brief table does) can still be labelled.
const CONJUGATION_PRONOUNS = ["ich", "du", "er/sie/es", "wir", "ihr", "sie/Sie"];
// Row index of each tense in the full grammar matrix: Präteritum, Perfekt,
// Präsens, Future, in that fixed order.
const CONJUGATION_TENSE_ROW: Record<ConjugationTense, number> = { preteritum: 0, perfekt: 1, present: 2, future: 3 };
const AFFIRMATION_COLUMN = 1;

// The full matrix writes each cell as a complete sentence starting with its
// subject ("ich habe gesungen") — but the field's own label already says
// "ich", so repeating it in the answer would just be retyping the label.
// The person is always the sentence's first word in an affirmative statement,
// so dropping it is a plain "cut the first token" rather than needing to know
// which exact pronoun the model chose for 3rd person (er/sie/es).
function stripLeadingPronoun(phrase: string): string {
  const parts = phrase.trim().split(/\s+/);
  return parts.slice(1).join(" ");
}

function stripSeparableSuffix(value: string, suffix?: string): string {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!suffix || words.length < 2 || words.at(-1)?.toLocaleLowerCase("de-DE") !== suffix.toLocaleLowerCase("de-DE")) {
    return value;
  }
  return words.slice(0, -1).join(" ");
}

function appendSeparableSuffix(value: string, suffix?: string): string {
  const clean = value.trim();
  if (!suffix || !clean) return clean;
  return `${stripSeparableSuffix(clean, suffix)} ${suffix}`;
}

function fieldAnswer(field: QuizField, value: string): string {
  return appendSeparableSuffix(value, field.suffix);
}

type QuizStep = {
  /** `${entry.id}:${mode}[:tense]` — stable across reshuffles, so React keys and refs track the right step. */
  key: string;
  entry: DictionaryEntry;
  mode: QuizMode;
  /** The schedule this step's answer moves. */
  drill: DrillKey;
  /** Which tense a conjugation step drills — every conjugation step has exactly one. */
  tense?: ConjugationTense;
  /** null while a conjugation/phrase step's AI data is still loading, [] if it failed and the step should be skipped. */
  fields: QuizField[] | null;
  /** A conjugation step's whole table, shown after the check — the persons not asked included. */
  paradigm?: StoredConjugationRow[];
  /** Picks the rotating person for this step; fixed when the step is built. */
  seed: number;
  /** The Russian sentence a phrase step asks to translate — the entry's own once it has one, an AI-generated one once fetched. */
  promptText?: string;
};

export function verbLemma(entry: DictionaryEntry): string {
  return entry.lemma || entry.headword;
}

function verbClassOf(entry: DictionaryEntry): GermanVerbClass {
  return classifyGermanVerb(verbLemma(entry).replace(/^sich\s+/iu, ""), entry.headword, entry.forms ?? {});
}

/**
 * A tense's table without the AI: generated from the stored principal parts
 * when the rules allow (lib/verbConjugation.ts), else read from the per-verb
 * store an earlier AI answer was saved to. null — only now must the AI be asked.
 */
export function conjugationOnDevice(entry: DictionaryEntry, tense: ConjugationTense, targetLanguage: string): StoredConjugationRow[] | null {
  if (targetLanguage === "de") {
    const forms = conjugateGermanLocally(verbLemma(entry), entry.forms ?? {}, tense, verbClassOf(entry));
    if (forms) return forms.map((form, i) => ({ label: GERMAN_PERSONS[i], form }));
  }
  return getLocalVerbConjugation(verbLemma(entry), tense, targetLanguage);
}

/**
 * The fields a conjugation step asks, out of the tense's whole table: every
 * person with «Все лица», otherwise only those where this verb can differ
 * from the plain endings (keyPersons). A table that is not the usual six
 * persons — an impersonal verb's single «es regnet» — is asked whole.
 */
function conjugationFields(entry: DictionaryEntry, tense: ConjugationTense, rows: StoredConjugationRow[], allPersons: boolean, seed: number): QuizField[] {
  const lemma = verbLemma(entry);
  const verbClass = verbClassOf(entry);
  const asked = allPersons || rows.length !== 6 ? rows.map((_, i) => i) : keyPersons(tense, verbClass, seed);
  return asked
    .filter((i) => rows[i]?.form.trim())
    .map((i) => {
      const row = rows[i];
      const label = verbClass === "impersonal" && rows.length === 6 && i === 2 ? "es" : row.label;
      if (tense !== "present") return { key: `${tense}-${i}`, label, expected: row.form };
      const suffix = getPresentSeparableSuffix(row.form, lemma, entry.forms?.trennbar);
      return {
        key: `${tense}-${i}`,
        label,
        expected: row.form,
        // wir/sie that just repeat the infinitive (wir können) are shown, not
        // asked — «sind» for sein is not the infinitive and stays a question.
        locked: isPresentPluralInfinitive(row.label, row.form, lemma, entry.forms?.trennbar),
        suffix: suffix ?? undefined,
      };
    });
}

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * One verb's worth of steps for whichever modes are switched on, in the fixed
 * translation → forms → conjugation → phrase order. A mode is skipped for a
 * verb that has nothing for it to ask (no stored translation, no example
 * sentence) rather than asking an unanswerable question.
 */
type QueueOptions = {
  modes: Set<QuizMode>;
  conjugationTenses: Set<ConjugationTense>;
  drillsByEntry?: Record<string, DrillKey[]>;
  allPersons: boolean;
  targetLanguage: string;
};

function stepsForEntry(entry: DictionaryEntry, options: QueueOptions): QuizStep[] {
  const steps: QuizStep[] = [];
  const drills = options.drillsByEntry?.[entry.id] ?? drillKeysFor(entry, options.modes, options.conjugationTenses);
  for (const drill of drills) {
    const seed = Math.floor(Math.random() * 720);
    if (drill === "translation") {
      const translation = entry.translation?.trim();
      if (translation) steps.push({ key: `${entry.id}:translation`, entry, mode: "translation", drill, seed, fields: [{ key: "translation", label: "Перевод", expected: translation }] });
    } else if (drill === "forms") {
      const fields: QuizField[] = [];
      if (entry.forms?.praeteritum) fields.push({ key: "praeteritum", label: "Präteritum", expected: entry.forms.praeteritum });
      if (entry.forms?.partizip2) fields.push({ key: "partizip2", label: "Partizip II", expected: entry.forms.partizip2 });
      if (fields.length) steps.push({ key: `${entry.id}:forms`, entry, mode: "forms", drill, seed, fields });
    } else if (drill === "phrase") {
      // The AI tutor creates the situation and evaluates natural variants
      // conversationally, so this step deliberately has no expected string.
      steps.push({ key: `${entry.id}:phrase`, entry, mode: "phrase", drill, seed, fields: null });
    } else {
      // Each selected tense is its own step. Built right here whenever the
      // table is on the device — no loading state, no AI call; only a verb
      // never seen before whose table cannot be generated waits for the AI.
      const tense = drill.slice("conjugation:".length) as ConjugationTense;
      const rows = conjugationOnDevice(entry, tense, options.targetLanguage);
      steps.push({
        key: `${entry.id}:conjugation:${tense}`, entry, mode: "conjugation", drill, tense, seed,
        fields: rows ? conjugationFields(entry, tense, rows, options.allPersons, seed) : null,
        paradigm: rows ?? undefined,
      });
    }
  }
  return steps;
}

function buildQueue(verbs: DictionaryEntry[], options: QueueOptions): QuizStep[] {
  return shuffle(verbs).flatMap((entry) => stepsForEntry(entry, options));
}

/**
 * Self-test built from whichever drills are switched on: recall the
 * translation, the principal parts, the conjugation, or use the verb in a
 * phrase. Not the flashcards' schedule — each drill has its own one here
 * (lib/srs/drillSchedule.ts), and the caller passes only the due drills.
 */
export function VerbsQuiz({ verbs, targetLanguage, nativeLanguage, modes, conjugationTenses, drillsByEntry, allPersons = false, onExit, onRecord, onComplete }: Props) {
  const [queue, setQueue] = useState<QuizStep[]>(() => buildQueue(verbs, { modes, conjugationTenses, drillsByEntry, allPersons, targetLanguage }));
  const [sessionId] = useState(newId);
  // 1 on the first pass, 2+ on each «повторить ошибки» round.
  const roundRef = useRef(1);
  const [index, setIndex] = useState(0);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Record<string, FieldResult>>({});
  // The translation is an optional hint. Keep this toggle across questions so
  // a learner who wants pure recall does not repeat the same tap each time.
  const [translationVisible, setTranslationVisible] = useState(true);
  // Fields peeked at before submitting — a look, not a graded answer, so it
  // does not touch `results` or count against the verdict.
  const [peeked, setPeeked] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState<QuizStep[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const dictateRefs = useRef<Array<DictateButtonHandle | null>>([]);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  const step = queue[index];
  const done = index >= queue.length;

  // A fresh step: put the cursor straight into the first field, on a
  // computer, so typing can start without reaching for the mouse first.
  // (revealed/inputs/results/peeked are already at their defaults by the time
  // any step becomes current — nextItem()/retryMistakes() below clear them
  // before ever advancing, and the very first step starts from useState's own
  // defaults — so there is nothing to reset here.) Re-fires once a
  // conjugation/phrase step's fields actually arrive, since there is nothing
  // to focus before that.
  useEffect(() => {
    if (step?.mode === "phrase") return;
    inputRefs.current[0]?.focus();
  }, [step?.key, step?.fields, step?.mode]);

  // Revealing disables every input — the one Enter was just pressed in among
  // them — so the browser drops focus onto <body>, outside .verb-quiz-card.
  // The next Enter then never reaches its keydown handler, since bubbling only
  // goes from the event's target up through its ancestors, and body isn't a
  // descendant of the card. Moving focus onto "Далее" keeps it inside.
  useEffect(() => {
    if (revealed) primaryButtonRef.current?.focus();
  }, [revealed]);

  // A conjugation step whose table is not on the device yet (a strong verb's
  // present, a verb whose stored forms the rules cannot read) asks the AI the
  // moment it becomes current — once: the six forms go into the per-verb
  // store, and every later session builds the step from there instantly.
  // Phrase steps own their conversational loading state in VerbPhraseTutor.
  useEffect(() => {
    if (!step || step.fields !== null || step.mode !== "conjugation") return;
    let cancelled = false;
    const entry = step.entry;
    const stepKey = step.key;
    const tense = step.tense ?? "present";

    (async () => {
      // Present: the cheap "brief" table the grammar modal's "Кратко" tab
      // fills. Other tenses: one row of the 4×3 matrix the "Полная" view uses,
      // each cell a sentence ("ich habe gesungen") with its pronoun cut off.
      const detail = tense === "present" ? "brief" : "full";
      const cacheKey = makeGrammarCacheKey(verbLemma(entry), detail, targetLanguage, nativeLanguage);
      let table = getLocalGrammar(cacheKey);
      if (!table) {
        try {
          table = await fetchGrammar({ word: entry.headword, lemma: entry.lemma, posTag: "verb", targetLanguage, nativeLanguage, detail });
          saveLocalGrammar(cacheKey, table);
        } catch {
          table = null;
        }
      }
      if (cancelled) return;

      let rows: StoredConjugationRow[];
      if (tense === "present") {
        rows = (table?.sections?.[0]?.cells ?? [])
          .filter((c) => c.pronoun?.trim() && c.form.trim())
          .map((c) => ({ label: c.pronoun!.trim(), form: c.form.trim() }));
      } else {
        const cell = table?.matrix?.cells?.[CONJUGATION_TENSE_ROW[tense]]?.[AFFIRMATION_COLUMN];
        rows = toRows(cell)
          .map((p, i) => ({ label: CONJUGATION_PRONOUNS[i] ?? p.form, form: stripLeadingPronoun(p.form) }))
          .filter((row) => row.form);
      }
      if (rows.length) saveLocalVerbConjugation(verbLemma(entry), tense, targetLanguage, rows);

      const fields = rows.length ? conjugationFields(entry, tense, rows, allPersons, step.seed) : [];
      if (fields.length === 0) {
        // The AI call failed or returned nothing usable — nothing left to ask,
        // so skip past it rather than leaving the learner at a blank card.
        setIndex((i) => i + 1);
        return;
      }
      setQueue((prev) => prev.map((s) => (s.key === stepKey ? { ...s, fields, paradigm: rows } : s)));
    })();
    return () => { cancelled = true; };
  }, [step, targetLanguage, nativeLanguage, allPersons]);

  function submit() {
    if (!step || revealed || !step.fields) return;
    const next: Record<string, FieldResult> = {};
    let allGood = true;
    let anyPeeked = false;
    // Forms do not forgive a missing umlaut, conjugation not even one wrong
    // letter: «fahrst» for «fährst», «besucht» for «besuchst» are exactly the
    // mistakes these drills exist to catch.
    const strictness = step.mode === "conjugation" ? "exact" : step.mode === "forms" ? "umlaut" : "lenient";
    for (const field of step.fields) {
      if (field.locked) continue;
      const given = fieldAnswer(field, inputs[field.key] ?? "");
      const check = checkAgainstAlternatives(given, field.expected, strictness);
      next[field.key] = { verdict: check.verdict, expected: check.matched, hint: check.hint };
      if (check.verdict === "wrong") allGood = false;
      if (peeked.has(field.key)) anyPeeked = true;
      logTrainingEvent({
        trainer: "verbs",
        mode: step.mode,
        sessionId,
        entryId: step.entry.id,
        word: step.entry.lemma || step.entry.headword,
        checks: step.mode === "conjugation" ? "conjugation" : step.mode === "forms" ? "form" : step.mode === "phrase" ? "sentence" : "translation",
        form: step.mode === "forms" ? field.key : null,
        pronoun: step.mode === "conjugation" ? field.label : null,
        tense: step.mode === "conjugation" ? (step.tense ?? "present") : null,
        prompt: step.promptText ?? step.entry.headword,
        answer: given,
        expected: field.expected,
        outcome: outcomeFromVerdict(check.verdict, given),
        attemptNo: roundRef.current,
        answerShown: peeked.has(field.key),
      });
    }
    // A peeked answer was read, not recalled: it still counts for the pack
    // bar, but the drill comes back tomorrow instead of in a few days.
    onRecord?.(step.entry.id, allGood, step.drill, allGood && !anyPeeked);
    if (allGood) {
      setCorrectCount((c) => c + 1);
      const hasLaterStepForEntry = queue.some((candidate, candidateIndex) => candidateIndex > index && candidate.entry.id === step.entry.id);
      const hasUnresolvedMistakeForEntry = mistakes.some((mistake) => mistake.entry.id === step.entry.id);
      if (!hasLaterStepForEntry && !hasUnresolvedMistakeForEntry) onComplete?.(step.entry.id);
      // Keep correct answers moving without an extra tap. Mistakes still
      // reveal their correction and wait for «Далее».
      nextItem();
    } else {
      setResults(next);
      setRevealed(true);
      setMistakes((m) => [...m, step]);
    }
  }

  function nextItem() {
    setRevealed(false);
    setInputs({});
    setResults({});
    setPeeked(new Set());
    setIndex((i) => i + 1);
  }

  function acceptPhrase() {
    if (!step) return;
    onRecord?.(step.entry.id, true, step.drill, true);
    // The tutor accepted a sentence using the verb: evidence of use, not of a form.
    logTrainingEvent({
      trainer: "verbs", mode: "phrase", sessionId, entryId: step.entry.id,
      word: step.entry.lemma || step.entry.headword, checks: "sentence", outcome: "correct", attemptNo: roundRef.current,
      meta: { judged_by: "ai_tutor" },
    });
    setCorrectCount((count) => count + 1);
    const hasLaterStepForEntry = queue.some((candidate, candidateIndex) => candidateIndex > index && candidate.entry.id === step.entry.id);
    const hasUnresolvedMistakeForEntry = mistakes.some((mistake) => mistake.entry.id === step.entry.id);
    if (!hasLaterStepForEntry && !hasUnresolvedMistakeForEntry) onComplete?.(step.entry.id);
  }

  function retryMistakes() {
    roundRef.current += 1;
    setQueue(shuffle(mistakes));
    setMistakes([]);
    setCorrectCount(0);
    setIndex(0);
    setRevealed(false);
    setInputs({});
    setResults({});
    setPeeked(new Set());
  }

  function updateFieldInput(field: QuizField, value: string) {
    setInputs((prev) => ({ ...prev, [field.key]: stripSeparableSuffix(value, field.suffix) }));
  }

  if (queue.length === 0) {
    return (
      <section className="screen verbs-view verb-quiz">
        <header className="screen-header">
          <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="eyebrow">Глаголы · тренировка</p>
            <h1>Нечего тренировать</h1>
          </div>
        </header>
        <div className="verb-quiz-summary">
          <p>Ни у одного слова нет данных для включённых режимов — например, для «Перевода» нужен сохранённый перевод.</p>
          <button type="button" className="secondary-btn" onClick={onExit}>Назад</button>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section className="screen verbs-view verb-quiz">
        <header className="screen-header">
          <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="eyebrow">Глаголы · тренировка</p>
            <h1>Готово</h1>
          </div>
        </header>

        <div className="verb-quiz-summary">
          <strong>{correctCount} из {queue.length} правильно</strong>
          {mistakes.length > 0 && (
            <button type="button" className="primary-btn" onClick={retryMistakes}>
              <RotateCcw size={16} style={{ marginRight: 6 }} /> Повторить ошибки ({mistakes.length})
            </button>
          )}
          <button type="button" className="secondary-btn" onClick={onExit}>Готово</button>
        </div>
      </section>
    );
  }

  if (!step) return null;

  const entry = step.entry;
  const isPhrase = step.mode === "phrase";
  const isConjugation = step.mode === "conjugation";
  // Forms and conjugation both build on knowing the word — the translation is
  // shown as a hint. Translation mode hides it, since it is the answer.
  const showTranslation = entry.translation && step.mode !== "translation";

  return (
    <section className="screen verbs-view verb-quiz">
      <header className="screen-header">
        <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">
            Глаголы · тренировка · {QUIZ_MODE_LABEL[step.mode]}
            {step.tense ? ` · ${CONJUGATION_TENSE_LABEL[step.tense]}` : ""}
          </p>
          <h1>{index + 1} / {queue.length}</h1>
        </div>
      </header>

      <div className="verb-quiz-card">
        {isPhrase ? (
          <VerbPhraseTutor
            key={step.key}
            entry={entry}
            targetLanguage={targetLanguage}
            nativeLanguage={nativeLanguage}
            onAccepted={acceptPhrase}
            onFinish={nextItem}
          />
        ) : (
          <>
        {isPhrase ? (
          step.fields === null ? (
            <div className="verb-quiz-skeleton">
              <div className="verb-quiz-skeleton-line loading-shimmer" style={{ width: "88%" }} />
              <div className="verb-quiz-skeleton-line loading-shimmer" style={{ width: "50%", height: 13 }} />
            </div>
          ) : (
            <>
              <p className="verb-quiz-phrase-prompt">{step.promptText}</p>
              <p className="verb-quiz-translation">с глаголом «{entry.headword}»</p>
            </>
          )
        ) : (
          <>
            <div className="verb-quiz-infinitive">
              <span>{entry.headword}</span>
              <SpeakButton text={entry.headword} lang={targetLanguage} size={16} />
            </div>
            {showTranslation && (
              <div className="verb-quiz-translation-row">
                <p className={`verb-quiz-translation${translationVisible ? "" : " quiz-translation-hidden"}`}>{entry.translation}</p>
                <button
                  type="button"
                  className="quiz-translation-toggle"
                  onClick={() => setTranslationVisible((visible) => !visible)}
                  aria-label={translationVisible ? "Скрыть перевод" : "Показать перевод"}
                  title={translationVisible ? "Скрыть перевод" : "Показать перевод"}
                >
                  {translationVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            )}
          </>
        )}

        {step.fields === null ? (
          isPhrase ? (
            <div className="verb-quiz-skeleton-line input loading-shimmer" />
          ) : (
            <div className="verb-quiz-loading"><Loader2 className="spin" size={18} /> Загружаю спряжение...</div>
          )
        ) : (
          <div className={isConjugation ? "verb-quiz-conjugation-grid" : undefined}>
            {step.fields.map((field, i) => {
              const result = results[field.key];
              return (
                <div key={field.key} className="verb-quiz-field">
                  <label htmlFor={`verb-quiz-${field.key}`}>
                    <span>{field.label}</span>
                    {field.locked && <span className="verb-quiz-field-note">как инфинитив</span>}
                  </label>
                  <div className="verb-quiz-input-row">
                    <input
                      id={`verb-quiz-${field.key}`}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      value={inputs[field.key] ?? (field.locked ? stripSeparableSuffix(field.expected, field.suffix) : "")}
                      disabled={revealed || field.locked}
                      onChange={(e) => updateFieldInput(field, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.ctrlKey && e.code === "Space") {
                          e.preventDefault();
                          dictateRefs.current[i]?.toggle();
                          return;
                        }
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const nextIndex = step.fields!.findIndex((candidate, candidateIndex) => candidateIndex > i && !candidate.locked);
                        if (nextIndex === -1) submit();
                        else inputRefs.current[nextIndex]?.focus();
                      }}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className={`verb-quiz-input${field.locked ? " locked" : ""}${field.suffix ? " has-suffix" : ""}${revealed && result ? ` ${result.verdict}` : ""}`}
                      aria-describedby={field.suffix ? `verb-quiz-suffix-${field.key}` : undefined}
                    />
                    {field.suffix && (
                      <span id={`verb-quiz-suffix-${field.key}`} className={`verb-quiz-input-suffix${field.locked ? " locked" : ""}`} aria-label={`Приставка ${field.suffix} добавляется автоматически`}>
                        {field.suffix}
                      </span>
                    )}
                    <DictateButton
                      ref={(el) => { dictateRefs.current[i] = el; }}
                      lang={isPhrase || isConjugation || step.mode === "forms" ? targetLanguage : nativeLanguage}
                      title="Сказать голосом (или Ctrl+Space в поле)"
                      disabled={revealed || field.locked}
                      onText={(text) => updateFieldInput(field, text)}
                    />
                    <button
                      type="button"
                      className={`dictate-btn${peeked.has(field.key) ? " peek-active" : ""}`}
                      disabled={revealed || field.locked}
                      onClick={() => setPeeked((prev) => {
                        const next = new Set(prev);
                        if (next.has(field.key)) next.delete(field.key);
                        else next.add(field.key);
                        return next;
                      })}
                      aria-label={peeked.has(field.key) ? "Скрыть подсказку" : "Подсмотреть подсказку"}
                      title={peeked.has(field.key) ? "Скрыть подсказку" : "Подсмотреть подсказку"}
                    >
                      {peeked.has(field.key) ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {revealed && result && result.verdict !== "correct" ? (
                    <span className={`verb-quiz-expected ${result.verdict}`}>
                      {diffExpected(fieldAnswer(field, inputs[field.key] ?? ""), result.expected).map((seg, si) => (
                        <span key={si} className={seg.changed ? "verb-quiz-diff" : undefined}>{seg.text}</span>
                      ))}
                      {result.hint && <span className="verb-quiz-hint"> · {result.hint}</span>}
                    </span>
                  ) : !revealed && peeked.has(field.key) ? (
                    <span className="verb-quiz-peek-hint">{field.expected}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Only one or two persons are asked; after a mistake the whole table
            is what shows where this verb's pattern breaks. */}
        {revealed && isConjugation && step.paradigm && step.paradigm.length > (step.fields?.length ?? 0) && (
          <dl className="verb-quiz-paradigm">
            {step.paradigm.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.form}</dd>
              </div>
            ))}
          </dl>
        )}

        {step.fields !== null && (
          !revealed ? (
            <button type="button" className="primary-btn" onClick={submit}>Проверить</button>
          ) : (
            <button type="button" ref={primaryButtonRef} className="primary-btn" onClick={nextItem}>Далее</button>
          )
        )}
          </>
        )}
      </div>
    </section>
  );
}
