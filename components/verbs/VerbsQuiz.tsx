"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Eye, EyeOff, Loader2, RotateCcw } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { checkTypedAnswer, diffExpected, type AnswerVerdict } from "@/lib/srs/activeTraining";
import { fetchGrammar } from "@/lib/ai/grammar";
import { makeGrammarCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalGrammar, saveLocalGrammar } from "@/lib/db/local";
import { CONJUGATION_TENSE_LABEL, CONJUGATION_TENSE_ORDER, QUIZ_MODE_LABEL, QUIZ_MODE_ORDER, type ConjugationTense, type QuizMode } from "@/lib/verbsQuizModes";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { DictateButton, type DictateButtonHandle } from "@/components/discover/DictateButton";
import { toRows } from "@/components/word-modal/GrammarModal";
import { getPresentSeparableSuffix, isPresentPluralInfinitive } from "@/lib/verbForms";
import { VerbPhraseTutor } from "@/components/verbs/VerbPhraseTutor";

type Props = {
  verbs: DictionaryEntry[];
  targetLanguage: string;
  nativeLanguage: string;
  modes: Set<QuizMode>;
  conjugationTenses: Set<ConjugationTense>;
  onExit: () => void;
  /** Reports one answered step so the pack's coverage bar can move. */
  onRecord?: (entryId: string, correct: boolean) => void;
  /** Marks a word complete for the current local day after all its steps pass. */
  onComplete?: (entryId: string) => void;
};

type QuizField = { key: string; label: string; expected: string; locked?: boolean; suffix?: string };
type FieldResult = { verdict: AnswerVerdict; expected: string };

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
  /** Which tense a conjugation step drills — every conjugation step has exactly one. */
  tense?: ConjugationTense;
  /** null while a conjugation/phrase step's AI data is still loading, [] if it failed and the step should be skipped. */
  fields: QuizField[] | null;
  /** The Russian sentence a phrase step asks to translate — the entry's own once it has one, an AI-generated one once fetched. */
  promptText?: string;
};

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
function stepsForEntry(entry: DictionaryEntry, modes: Set<QuizMode>, conjugationTenses: Set<ConjugationTense>): QuizStep[] {
  const steps: QuizStep[] = [];
  for (const mode of QUIZ_MODE_ORDER) {
    if (!modes.has(mode)) continue;
    if (mode === "translation") {
      const translation = entry.translation?.trim();
      if (translation) steps.push({ key: `${entry.id}:translation`, entry, mode, fields: [{ key: "translation", label: "Перевод", expected: translation }] });
    } else if (mode === "forms") {
      const fields: QuizField[] = [];
      if (entry.forms?.praeteritum) fields.push({ key: "praeteritum", label: "Präteritum", expected: entry.forms.praeteritum });
      if (entry.forms?.partizip2) fields.push({ key: "partizip2", label: "Partizip II", expected: entry.forms.partizip2 });
      if (fields.length) steps.push({ key: `${entry.id}:forms`, entry, mode, fields });
    } else if (mode === "conjugation") {
      // Each selected tense is its own step (up to 6 fields, same as the
      // original present-only drill) rather than one step with as many as 18.
      for (const tense of CONJUGATION_TENSE_ORDER) {
        if (!conjugationTenses.has(tense)) continue;
        steps.push({ key: `${entry.id}:conjugation:${tense}`, entry, mode, tense, fields: null });
      }
    } else if (mode === "phrase") {
      // The AI tutor creates the situation and evaluates natural variants
      // conversationally, so this step deliberately has no expected string.
      const example = "";
      const exampleTranslation = "";
      steps.push(example && exampleTranslation
        ? { key: `${entry.id}:phrase`, entry, mode, fields: [{ key: "german", label: "Немецкий", expected: example }], promptText: exampleTranslation }
        : { key: `${entry.id}:phrase`, entry, mode, fields: null });
    }
  }
  return steps;
}

function buildQueue(verbs: DictionaryEntry[], modes: Set<QuizMode>, conjugationTenses: Set<ConjugationTense>): QuizStep[] {
  return shuffle(verbs).flatMap((entry) => stepsForEntry(entry, modes, conjugationTenses));
}

/**
 * Session-only self-test built from whichever drills are switched on: recall
 * the translation, the principal parts, the present-tense conjugation, or
 * translate a phrase that uses the verb. Deliberately not wired into the SM-2
 * flashcard schedule — this is a drill on top of the dictionary the learner
 * already has, not a second spaced-repetition track for the same words.
 */
export function VerbsQuiz({ verbs, targetLanguage, nativeLanguage, modes, conjugationTenses, onExit, onRecord, onComplete }: Props) {
  const [queue, setQueue] = useState<QuizStep[]>(() => buildQueue(verbs, modes, conjugationTenses));
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
    inputRefs.current[0]?.focus();
  }, [step?.key, step?.fields]);

  // Revealing disables every input — the one Enter was just pressed in among
  // them — so the browser drops focus onto <body>, outside .verb-quiz-card.
  // The next Enter then never reaches its keydown handler, since bubbling only
  // goes from the event's target up through its ancestors, and body isn't a
  // descendant of the card. Moving focus onto "Далее" keeps it inside.
  useEffect(() => {
    if (revealed) primaryButtonRef.current?.focus();
  }, [revealed]);

  // Fetches a conjugation step's AI-generated content the moment it becomes
  // current. Phrase steps own their conversational loading state in
  // VerbPhraseTutor, so they never block this quiz effect.
  useEffect(() => {
    if (!step || step.fields !== null) return;
    if (step.mode !== "conjugation") return;
    let cancelled = false;
    const entry = step.entry;
    const stepKey = step.key;

    (async () => {
      if (step.mode === "conjugation") {
        const tense = step.tense ?? "present";
        let fields: QuizField[];

        if (tense === "present") {
          // The original drill: a bare conjugated word ("singe"), from the
          // same cheap "brief" table the grammar modal's "Кратко" tab already
          // fills and caches — unchanged from before tenses existed.
          const cacheKey = makeGrammarCacheKey(entry.lemma || entry.headword, "brief", targetLanguage, nativeLanguage);
          let table = getLocalGrammar(cacheKey);
          if (!table) {
            try {
              table = await fetchGrammar({
                word: entry.headword,
                lemma: entry.lemma,
                posTag: "verb",
                targetLanguage,
                nativeLanguage,
                detail: "brief",
              });
              saveLocalGrammar(cacheKey, table);
            } catch {
              table = null;
            }
          }
          if (cancelled) return;
          const cells = table?.sections?.[0]?.cells ?? [];
          fields = cells
            .filter((c) => c.pronoun?.trim() && c.form.trim())
            .map((c) => {
              const suffix = getPresentSeparableSuffix(c.form, entry.lemma || entry.headword, entry.forms?.trennbar);
              return {
                key: c.pronoun!,
                label: c.pronoun!,
                expected: c.form,
                locked: isPresentPluralInfinitive(c.pronoun!, c.form, entry.lemma || entry.headword, entry.forms?.trennbar),
                suffix: suffix ?? undefined,
              };
            });
        } else {
          // Präteritum, Perfekt and future have no dedicated "brief" shape —
          // pull them from the same 4×3 matrix the "Полная" grammar view uses
          // and caches, one row of it. Each cell there is a complete sentence
          // ("ich habe gesungen"); the leading pronoun is stripped since the
          // field's own label already says it — what is actually being tested
          // is the rest ("habe gesungen"), auxiliary included.
          const cacheKey = makeGrammarCacheKey(entry.lemma || entry.headword, "full", targetLanguage, nativeLanguage);
          let table = getLocalGrammar(cacheKey);
          if (!table) {
            try {
              table = await fetchGrammar({
                word: entry.headword,
                lemma: entry.lemma,
                posTag: "verb",
                targetLanguage,
                nativeLanguage,
                detail: "full",
              });
              saveLocalGrammar(cacheKey, table);
            } catch {
              table = null;
            }
          }
          if (cancelled) return;
          const rowIndex = CONJUGATION_TENSE_ROW[tense];
          const cell = table?.matrix?.cells?.[rowIndex]?.[AFFIRMATION_COLUMN];
          fields = toRows(cell)
            .map((p, i) => ({ key: `${tense}-${i}`, label: CONJUGATION_PRONOUNS[i] ?? p.form, expected: stripLeadingPronoun(p.form) }))
            .filter((f) => f.expected);
        }

        if (fields.length === 0) {
          // No cached table and the AI call failed or returned nothing usable
          // — nothing left to ask, so skip past it rather than leaving the
          // learner staring at a blank card.
          setIndex((i) => i + 1);
          return;
        }
        setQueue((prev) => prev.map((s) => (s.key === stepKey ? { ...s, fields } : s)));
      }
    })();
    return () => { cancelled = true; };
  }, [step, targetLanguage, nativeLanguage]);

  function submit() {
    if (!step || revealed || !step.fields) return;
    const next: Record<string, FieldResult> = {};
    let allGood = true;
    for (const field of step.fields) {
      if (field.locked) continue;
      const check = checkTypedAnswer(fieldAnswer(field, inputs[field.key] ?? ""), field.expected);
      next[field.key] = { verdict: check.verdict, expected: field.expected };
      if (check.verdict === "wrong") allGood = false;
    }
    onRecord?.(step.entry.id, allGood);
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
    onRecord?.(step.entry.id, true);
    setCorrectCount((count) => count + 1);
    const hasLaterStepForEntry = queue.some((candidate, candidateIndex) => candidateIndex > index && candidate.entry.id === step.entry.id);
    const hasUnresolvedMistakeForEntry = mistakes.some((mistake) => mistake.entry.id === step.entry.id);
    if (!hasLaterStepForEntry && !hasUnresolvedMistakeForEntry) onComplete?.(step.entry.id);
  }

  function retryMistakes() {
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
                    </span>
                  ) : !revealed && peeked.has(field.key) ? (
                    <span className="verb-quiz-peek-hint">{field.expected}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
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
