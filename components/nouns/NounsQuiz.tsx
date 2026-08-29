"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronLeft, Eye, EyeOff, Lightbulb, RotateCcw } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { checkTypedAnswer, diffExpected, type AnswerVerdict } from "@/lib/srs/activeTraining";
import { bareNoun, genderRuleExplanation, genderRuleHint, nounArticle, nounGender, suffixRuleFor, GENDER_ARTICLE } from "@/lib/nounForms";
import { getLocalGenderRuleStats, saveLocalGenderRuleStats } from "@/lib/db/local";
import { NOUN_QUIZ_MODE_LABEL, NOUN_QUIZ_MODE_ORDER, type NounQuizMode } from "@/lib/nounsQuizModes";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { DictateButton, type DictateButtonHandle } from "@/components/discover/DictateButton";

type Props = {
  nouns: DictionaryEntry[];
  targetLanguage: string;
  nativeLanguage: string;
  modes: Set<NounQuizMode>;
  onExit: () => void;
  /** Reports one answered step so the pack's coverage bar can move. */
  onRecord: (entryId: string, correct: boolean) => void;
};

type QuizField = { key: string; label: string; expected: string };
type FieldResult = { verdict: AnswerVerdict; expected: string };

/**
 * What happened on a question that has already been answered.
 *
 * Kept whole (not just the verdict) so "Назад" can re-show the card exactly as
 * it was left — the option that was tapped, the text that was typed, the
 * mistakes marked — instead of re-opening a question that was already scored.
 */
type AnsweredStep = {
  ok: boolean;
  choice: string | null;
  inputs: Record<string, string>;
  results: Record<string, FieldResult>;
};

/** The three articles a German noun can take — the whole decision space, so the whole option list. */
const ARTICLE_CHOICES = ["der", "die", "das"];

type NounQuizStep = {
  /** `${entry.id}:${mode}` — stable across reshuffles, so React keys track the right step. */
  key: string;
  entry: DictionaryEntry;
  mode: NounQuizMode;
  /** Typed steps: the fields to fill in. Empty for the article step, which is a choice. */
  fields: QuizField[];
  /** Article step only: the correct article, matched against the tapped option. */
  answer?: string;
  /** What the card asks — the Russian side for a production step. */
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
 * One noun's worth of steps for whichever drills are switched on, in the fixed
 * translation → article → plural → word order. A drill is skipped for a noun
 * that has nothing for it to ask (no stored plural, no known gender) rather
 * than asking an unanswerable question.
 */
function stepsForEntry(entry: DictionaryEntry, modes: Set<NounQuizMode>): NounQuizStep[] {
  const steps: NounQuizStep[] = [];
  const translation = entry.translation?.trim();
  const article = nounArticle(entry);
  const bare = bareNoun(entry);

  for (const mode of NOUN_QUIZ_MODE_ORDER) {
    if (!modes.has(mode)) continue;

    if (mode === "translation") {
      if (translation) {
        steps.push({
          key: `${entry.id}:translation`,
          entry,
          mode,
          fields: [{ key: "translation", label: "Перевод", expected: translation }],
        });
      }
    } else if (mode === "article") {
      const gender = nounGender(entry);
      if (gender) {
        steps.push({ key: `${entry.id}:article`, entry, mode, fields: [], answer: GENDER_ARTICLE[gender] });
      }
    } else if (mode === "plural") {
      const plural = entry.plural?.trim();
      if (plural) {
        steps.push({
          key: `${entry.id}:plural`,
          entry,
          mode,
          fields: [{ key: "plural", label: "Множественное число", expected: plural }],
        });
      }
    } else if (mode === "word") {
      // Production: from the Russian back to the German — article included,
      // which is the whole point of drilling nouns rather than bare words.
      if (translation && article && bare) {
        steps.push({
          key: `${entry.id}:word`,
          entry,
          mode,
          fields: [{ key: "word", label: "Слово с артиклем", expected: `${article} ${bare}` }],
          promptText: translation,
        });
      }
    }
  }
  return steps;
}

function buildQueue(nouns: DictionaryEntry[], modes: Set<NounQuizMode>): NounQuizStep[] {
  return shuffle(nouns).flatMap((entry) => stepsForEntry(entry, modes));
}

/**
 * Session-only self-test over the nouns already in the learner's dictionary:
 * name the article, the plural, the meaning, or produce the whole thing from
 * the Russian. The article drill is a three-way choice rather than a typing
 * field — the answer is one of exactly three words, and tapping it is what
 * makes the drill fast enough to do a whole pack in a couple of minutes.
 *
 * Like the verb trainer this is deliberately outside the SM-2 flashcard
 * schedule; what it does feed is the pack's coverage bar, through `onRecord`.
 */
export function NounsQuiz({ nouns, targetLanguage, nativeLanguage, modes, onExit, onRecord }: Props) {
  const [queue, setQueue] = useState<NounQuizStep[]>(() => buildQueue(nouns, modes));
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [hintOpen, setHintOpen] = useState(false);
  // Fields peeked at before submitting — a look, not a graded answer.
  const [peeked, setPeeked] = useState<Set<string>>(new Set());
  const [mistakes, setMistakes] = useState<NounQuizStep[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  // Every question already answered, by step key. The tick/cross strip reads
  // it, "Назад" replays it, and its presence is what "revealed" means — so a
  // question can never be scored twice.
  const [answers, setAnswers] = useState<Record<string, AnsweredStep>>({});
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const dictateRefs = useRef<Array<DictateButtonHandle | null>>([]);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  const step = queue[index];
  const done = index >= queue.length;
  const isArticleStep = step?.mode === "article";
  const answered = step ? answers[step.key] : undefined;
  // "Revealed" is not a flag to keep in sync — it simply means this question
  // has an answer on record.
  const revealed = Boolean(answered);
  const inputs = answered?.inputs ?? draft;
  const results = answered?.results ?? {};
  const choice = answered?.choice ?? null;

  // A fresh step: cursor straight into the first field on a computer, so
  // typing can start without reaching for the mouse. The article step has no
  // field to focus — the choices take the tap instead.
  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, [step?.key]);

  // Revealing disables every input, so the browser drops focus onto <body> and
  // the next Enter never reaches the card. Moving focus onto «Далее» keeps it
  // inside — the same fix the verb trainer needs, for the same reason.
  useEffect(() => {
    if (revealed) primaryButtonRef.current?.focus();
  }, [revealed]);

  const word = step ? step.entry.lemma || step.entry.headword : "";
  // The nudge before the answer and the debrief after it are deliberately two
  // different texts: the first points at the rule without naming the gender,
  // the second says everything — including when this very word is the rule's
  // own exception.
  const ruleHint = useMemo(() => (word ? genderRuleHint(word) : null), [word]);
  const ruleExplanation = useMemo(
    () => (step ? genderRuleExplanation(word, nounGender(step.entry)) : null),
    [step, word],
  );

  function finishStep(allGood: boolean, record: Omit<AnsweredStep, "ok">) {
    if (!step) return;
    setAnswers((prev) => ({ ...prev, [step.key]: { ok: allGood, ...record } }));
    onRecord(step.entry.id, allGood);
    if (allGood) setCorrectCount((c) => c + 1);
    else setMistakes((m) => [...m, step]);

    // Score the ENDING, not the word: "-ent and -ment keep getting mixed up"
    // is something the learner can go and fix; "you missed Dokument" is not.
    if (step.mode === "article") {
      const rule = suffixRuleFor(word);
      if (rule) {
        const stats = getLocalGenderRuleStats();
        const prev = stats[rule.id] ?? { right: 0, wrong: 0 };
        stats[rule.id] = allGood
          ? { ...prev, right: prev.right + 1 }
          : { ...prev, wrong: prev.wrong + 1 };
        saveLocalGenderRuleStats(stats);
      }
    }
  }

  function submit() {
    if (!step || revealed || isArticleStep) return;
    const next: Record<string, FieldResult> = {};
    let allGood = true;
    for (const field of step.fields) {
      const check = checkTypedAnswer(draft[field.key] ?? "", field.expected);
      next[field.key] = { verdict: check.verdict, expected: field.expected };
      if (check.verdict === "wrong") allGood = false;
    }
    finishStep(allGood, { choice: null, inputs: draft, results: next });
  }

  function chooseArticle(option: string) {
    if (!step || revealed) return;
    finishStep(option === step.answer, { choice: option, inputs: {}, results: {} });
  }

  /** Moves to another question, carrying nothing typed on this one with it. */
  function goTo(next: number) {
    setDraft({});
    setHintOpen(false);
    setPeeked(new Set());
    setIndex(next);
  }

  function nextItem() {
    goTo(index + 1);
  }

  /**
   * Step back to the previous question, which has already been answered.
   *
   * Nothing is re-scored: the verdict it got the first time stands, and this
   * is only a way to re-read an explanation that was scrolled past. Re-grading
   * it would turn "Назад" into a way to farm a perfect score.
   */
  function previousItem() {
    if (index === 0) return;
    goTo(index - 1);
  }

  function retryMistakes() {
    setAnswers({});
    setQueue(shuffle(mistakes));
    setMistakes([]);
    setCorrectCount(0);
    goTo(0);
  }

  if (queue.length === 0) {
    return (
      <section className="screen verbs-view verb-quiz">
        <header className="screen-header">
          <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
            <ArrowLeft size={20} />
          </button>
          <div>
            <p className="eyebrow">Существительные · тренировка</p>
            <h1>Нечего тренировать</h1>
          </div>
        </header>
        <div className="verb-quiz-summary">
          <p>Ни у одного слова нет данных для включённых режимов — для «Артикля» нужен известный род, для «Мн. числа» — сохранённая форма множественного числа.</p>
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
            <p className="eyebrow">Существительные · тренировка</p>
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
  const isProduction = step.mode === "word";
  // Every drill but «Перевод» builds on knowing the word, so the translation is
  // shown as a hint. «Перевод» hides it — it is the answer.
  const showTranslation = entry.translation && step.mode !== "translation" && !isProduction;

  return (
    <section className="screen verbs-view verb-quiz noun-quiz">
      <header className="screen-header">
        <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Существительные · тренировка · {NOUN_QUIZ_MODE_LABEL[step.mode]}</p>
          <h1>{index + 1} / {queue.length}</h1>
        </div>
      </header>

      {/* One segment per question, filled as the session moves — the same
          at-a-glance «сколько осталось» the pack list gives, inside a session. */}
      <div className="noun-quiz-dots" aria-hidden>
        {queue.map((s, i) => {
          const verdict = answers[s.key]?.ok;
          const tone = verdict === undefined ? "" : verdict ? " ok" : " miss";
          return (
            <span key={s.key} className={`noun-quiz-dot${i === index ? " current" : ""}${tone}`}>
              {verdict === undefined ? null : verdict ? <Check size={10} /> : <span className="noun-quiz-dot-x">&times;</span>}
            </span>
          );
        })}
      </div>

      <div className="verb-quiz-card">
        {isProduction ? (
          <>
            <p className="verb-quiz-phrase-prompt">{step.promptText}</p>
            <p className="verb-quiz-translation">напишите слово с артиклем</p>
          </>
        ) : (
          <>
            <div className="verb-quiz-infinitive">
              {/* The article is the answer in the article drill, so the word is
                  shown bare there and with its article everywhere else. */}
              <span>{isArticleStep ? bareNoun(entry) : entry.headword}</span>
              <SpeakButton text={entry.headword} lang={targetLanguage} size={16} />
            </div>
            {showTranslation && <p className="verb-quiz-translation">{entry.translation}</p>}
          </>
        )}

        {isArticleStep ? (
          <>
            <div className="noun-quiz-choices">
              {ARTICLE_CHOICES.map((option) => {
                const state = !revealed
                  ? ""
                  : option === step.answer
                    ? " correct"
                    : option === choice
                      ? " wrong"
                      : "";
                return (
                  <button
                    key={option}
                    type="button"
                    className={`noun-quiz-choice${state}${choice === option ? " picked" : ""}`}
                    disabled={revealed}
                    onClick={() => chooseArticle(option)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>

            {!revealed && (
              <button
                type="button"
                className={`noun-quiz-hint-toggle${hintOpen ? " active" : ""}`}
                onClick={() => setHintOpen((v) => !v)}
                aria-expanded={hintOpen}
              >
                <Lightbulb size={14} /> {hintOpen ? "Скрыть подсказку" : "Показать подсказку"}
              </button>
            )}
            {hintOpen && !revealed && (
              <p className="noun-quiz-hint">
                {ruleHint ?? "У этого слова нет правила по окончанию — такие приходится запоминать вместе с артиклем. Попробуйте вспомнить, где вы его встречали."}
              </p>
            )}
            {revealed && (
              <p className={`noun-quiz-explain${answered?.ok ? " ok" : " miss"}`}>
                <strong>{answered?.ok ? "Верно! " : `Правильный ответ — ${step.answer}. `}</strong>
                {ruleExplanation ?? "У этого слова нет подходящего правила по окончанию — его род нужно запомнить отдельно."}
              </p>
            )}
          </>
        ) : (
          <div>
            {step.fields.map((field, i) => {
              const result = results[field.key];
              return (
                <div key={field.key} className="verb-quiz-field">
                  <label htmlFor={`noun-quiz-${field.key}`}>{field.label}</label>
                  <div className="verb-quiz-input-row">
                    <input
                      id={`noun-quiz-${field.key}`}
                      ref={(el) => { inputRefs.current[i] = el; }}
                      type="text"
                      value={inputs[field.key] ?? ""}
                      disabled={revealed}
                      onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.ctrlKey && e.code === "Space") {
                          e.preventDefault();
                          dictateRefs.current[i]?.toggle();
                          return;
                        }
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        const isLast = i === step.fields.length - 1;
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
                      lang={step.mode === "translation" ? nativeLanguage : targetLanguage}
                      title="Сказать голосом (или Ctrl+Space в поле)"
                      disabled={revealed}
                      onText={(text) => setDraft((prev) => ({ ...prev, [field.key]: text }))}
                    />
                    <button
                      type="button"
                      className={`dictate-btn${peeked.has(field.key) ? " peek-active" : ""}`}
                      disabled={revealed}
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
                      {diffExpected(inputs[field.key] ?? "", result.expected).map((seg, si) => (
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

        <div className="noun-quiz-actions">
          {index > 0 && (
            <button type="button" className="secondary-btn noun-quiz-back" onClick={previousItem}>
              <ChevronLeft size={16} /> Назад
            </button>
          )}
          {!revealed ? (
            isArticleStep ? null : (
              <button type="button" className="primary-btn" onClick={submit}>Проверить</button>
            )
          ) : (
            <button type="button" ref={primaryButtonRef} className="primary-btn" onClick={nextItem}>Далее</button>
          )}
        </div>
      </div>
    </section>
  );
}
