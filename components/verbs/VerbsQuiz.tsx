"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { checkTypedAnswer, diffExpected, type AnswerVerdict } from "@/lib/srs/activeTraining";
import { fetchGrammar } from "@/lib/ai/grammar";
import { makeGrammarCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalGrammar, saveLocalGrammar } from "@/lib/db/local";
import { QUIZ_MODE_LABEL, QUIZ_MODE_ORDER, type QuizMode } from "@/lib/verbsQuizModes";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { DictateButton, type DictateButtonHandle } from "@/components/discover/DictateButton";

type Props = {
  verbs: DictionaryEntry[];
  targetLanguage: string;
  nativeLanguage: string;
  modes: Set<QuizMode>;
  onExit: () => void;
};

type QuizField = { key: string; label: string; expected: string };
type FieldResult = { verdict: AnswerVerdict; expected: string };

type QuizStep = {
  /** `${entry.id}:${mode}` — stable across reshuffles, so React keys and refs track the right step. */
  key: string;
  entry: DictionaryEntry;
  mode: QuizMode;
  /** null while a conjugation step's grammar table is still loading, [] if it failed and the step should be skipped. */
  fields: QuizField[] | null;
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
function stepsForEntry(entry: DictionaryEntry, modes: Set<QuizMode>): QuizStep[] {
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
      steps.push({ key: `${entry.id}:conjugation`, entry, mode, fields: null });
    } else if (mode === "phrase") {
      const example = entry.example?.trim();
      const exampleTranslation = entry.example_translation?.trim();
      if (example && exampleTranslation) {
        steps.push({ key: `${entry.id}:phrase`, entry, mode, fields: [{ key: "german", label: "Немецкий", expected: example }] });
      }
    }
  }
  return steps;
}

function buildQueue(verbs: DictionaryEntry[], modes: Set<QuizMode>): QuizStep[] {
  return shuffle(verbs).flatMap((entry) => stepsForEntry(entry, modes));
}

/**
 * Session-only self-test built from whichever drills are switched on: recall
 * the translation, the principal parts, the present-tense conjugation, or
 * translate a phrase that uses the verb. Deliberately not wired into the SM-2
 * flashcard schedule — this is a drill on top of the dictionary the learner
 * already has, not a second spaced-repetition track for the same words.
 */
export function VerbsQuiz({ verbs, targetLanguage, nativeLanguage, modes, onExit }: Props) {
  const [queue, setQueue] = useState<QuizStep[]>(() => buildQueue(verbs, modes));
  const [index, setIndex] = useState(0);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState<Record<string, FieldResult>>({});
  const [mistakes, setMistakes] = useState<QuizStep[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const dictateRefs = useRef<Array<DictateButtonHandle | null>>([]);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  const step = queue[index];
  const done = index >= queue.length;

  // A fresh step: put the cursor straight into the first field, on a computer,
  // so typing can start without reaching for the mouse first. Re-fires once a
  // conjugation step's fields actually arrive, since there is nothing to focus
  // before that.
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

  // Fetches a conjugation step's present-tense forms the moment it becomes
  // current — not for the whole queue up front, which would mean an AI call
  // per verb before the session could even start. Reuses the exact cache the
  // grammar modal's "Кратко" view already fills, so a verb looked up there
  // once needs no network call here at all.
  useEffect(() => {
    if (!step || step.mode !== "conjugation" || step.fields !== null) return;
    let cancelled = false;
    const entry = step.entry;
    (async () => {
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
      const fields: QuizField[] = cells
        .filter((c) => c.pronoun?.trim() && c.form.trim())
        .map((c) => ({ key: c.pronoun!, label: c.pronoun!, expected: c.form }));
      if (fields.length === 0) {
        // No cached table and the AI call failed or returned nothing usable —
        // nothing left to ask, so skip past it instead of leaving the learner
        // staring at a blank card.
        setIndex((i) => i + 1);
        return;
      }
      setQueue((prev) => prev.map((s) => (s.key === step.key ? { ...s, fields } : s)));
    })();
    return () => { cancelled = true; };
  }, [step, targetLanguage, nativeLanguage]);

  function submit() {
    if (!step || revealed || !step.fields) return;
    const next: Record<string, FieldResult> = {};
    let allGood = true;
    for (const field of step.fields) {
      const check = checkTypedAnswer(inputs[field.key] ?? "", field.expected);
      next[field.key] = { verdict: check.verdict, expected: field.expected };
      if (check.verdict === "wrong") allGood = false;
    }
    setResults(next);
    setRevealed(true);
    if (allGood) setCorrectCount((c) => c + 1);
    else setMistakes((m) => [...m, step]);
  }

  function nextItem() {
    setRevealed(false);
    setInputs({});
    setResults({});
    setIndex((i) => i + 1);
  }

  function retryMistakes() {
    setQueue(shuffle(mistakes));
    setMistakes([]);
    setCorrectCount(0);
    setIndex(0);
    setRevealed(false);
    setInputs({});
    setResults({});
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
          <p>Ни у одного слова нет данных для включённых режимов — например, для «Фраз» нужен сохранённый пример предложения.</p>
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
          <p className="eyebrow">Глаголы · тренировка · {QUIZ_MODE_LABEL[step.mode]}</p>
          <h1>{index + 1} / {queue.length}</h1>
        </div>
      </header>

      <div className="verb-quiz-card">
        {isPhrase ? (
          <>
            <p className="verb-quiz-phrase-prompt">{entry.example_translation}</p>
            <p className="verb-quiz-translation">с глаголом «{entry.headword}»</p>
          </>
        ) : (
          <>
            <div className="verb-quiz-infinitive">
              <span>{entry.headword}</span>
              <SpeakButton text={entry.headword} lang={targetLanguage} size={16} />
            </div>
            {showTranslation && <p className="verb-quiz-translation">{entry.translation}</p>}
          </>
        )}

        {step.fields === null ? (
          <div className="verb-quiz-loading"><Loader2 className="spin" size={18} /> Загружаю спряжение...</div>
        ) : (
          <div className={isConjugation ? "verb-quiz-conjugation-grid" : undefined}>
            {step.fields.map((field, i) => {
              const result = results[field.key];
              return (
                <div key={field.key} className="verb-quiz-field">
                  <label htmlFor={`verb-quiz-${field.key}`}>{field.label}</label>
                  <div className="verb-quiz-input-row">
                    <input
                      id={`verb-quiz-${field.key}`}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      value={inputs[field.key] ?? ""}
                      disabled={revealed}
                      onChange={(e) => setInputs((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.ctrlKey && e.code === "Space") {
                          e.preventDefault();
                          dictateRefs.current[i]?.toggle();
                          return;
                        }
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const isLast = i === step.fields!.length - 1;
                        if (isLast) submit();
                        else inputRefs.current[i + 1]?.focus();
                      }}
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className={`verb-quiz-input${revealed && result ? ` ${result.verdict}` : ""}`}
                    />
                    <DictateButton
                      ref={(el) => { dictateRefs.current[i] = el; }}
                      lang={isPhrase || isConjugation || step.mode === "forms" ? targetLanguage : nativeLanguage}
                      title="Сказать голосом (или Ctrl+Space в поле)"
                      disabled={revealed}
                      onText={(text) => setInputs((prev) => ({ ...prev, [field.key]: text }))}
                    />
                  </div>
                  {revealed && result && result.verdict !== "correct" && (
                    <span className={`verb-quiz-expected ${result.verdict}`}>
                      {diffExpected(inputs[field.key] ?? "", result.expected).map((seg, si) => (
                        <span key={si} className={seg.changed ? "verb-quiz-diff" : undefined}>{seg.text}</span>
                      ))}
                    </span>
                  )}
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
      </div>
    </section>
  );
}
