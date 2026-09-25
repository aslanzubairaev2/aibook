"use client";

import { useState } from "react";
import { ArrowLeft, ChevronLeft, Lightbulb, RotateCcw } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { SpeakButton } from "@/components/ui/SpeakButton";
import {
  CASE_LABEL,
  PREPOSITION_CASE_ORDER,
  prepositionCaseExplanation,
  prepositionCaseFor,
  prepositionCaseHint,
  type PrepositionCase,
} from "@/lib/prepositionForms";
import { shuffled } from "@/lib/otherPosQuizModes";

type Props = {
  entries: DictionaryEntry[];
  targetLanguage: string;
  onExit: () => void;
  /** Reports one answered word so the pack's coverage bar can move. */
  onRecord: (entryId: string, correct: boolean) => void;
};

type PrepositionStep = {
  key: string;
  entry: DictionaryEntry;
  answer: PrepositionCase;
};

type AnsweredStep = { ok: boolean; choice: PrepositionCase };

function buildQueue(entries: DictionaryEntry[]): PrepositionStep[] {
  const steps = entries
    .map((entry) => {
      const answer = prepositionCaseFor(entry);
      return answer ? { key: entry.id, entry, answer } : null;
    })
    .filter((step): step is PrepositionStep => step !== null);
  return shuffled(steps);
}

/**
 * Session-only self-test over the prepositions already in the learner's
 * dictionary: which case does this preposition govern. Four-way choice
 * (Akkusativ / Dativ / Genitiv / Wechsel) rather than typing, for the same
 * reason the article drill is a tap — the answer is always one of a fixed,
 * small set.
 */
export function PrepositionQuiz({ entries, targetLanguage, onExit, onRecord }: Props) {
  const [queue, setQueue] = useState<PrepositionStep[]>(() => buildQueue(entries));
  const [index, setIndex] = useState(0);
  const [hintOpen, setHintOpen] = useState(false);
  const [mistakes, setMistakes] = useState<PrepositionStep[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnsweredStep>>({});

  const step = queue[index];
  const done = index >= queue.length;
  const answered = step ? answers[step.key] : undefined;
  const revealed = Boolean(answered);

  function choose(option: PrepositionCase) {
    if (!step || revealed) return;
    const ok = option === step.answer;
    setAnswers((prev) => ({ ...prev, [step.key]: { ok, choice: option } }));
    onRecord(step.entry.id, ok);
    if (ok) {
      setCorrectCount((c) => c + 1);
      goTo(index + 1);
    } else {
      setMistakes((m) => [...m, step]);
    }
  }

  function goTo(next: number) {
    setHintOpen(false);
    setIndex(next);
  }

  function previousItem() {
    if (index === 0) return;
    goTo(index - 1);
  }

  function retryMistakes() {
    setAnswers({});
    setQueue(shuffled(mistakes));
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
            <p className="eyebrow">Предлоги · тренировка</p>
            <h1>Нечего тренировать</h1>
          </div>
        </header>
        <div className="verb-quiz-summary">
          <p>Ни один предлог из словаря не попал в таблицу падежей.</p>
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
            <p className="eyebrow">Предлоги · тренировка</p>
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

  const word = step.entry.lemma || step.entry.headword;

  return (
    <section className="screen verbs-view verb-quiz noun-quiz">
      <header className="screen-header">
        <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Предлоги · тренировка · Падеж</p>
          <h1>{index + 1} / {queue.length}</h1>
        </div>
      </header>

      <div className="verb-quiz-card">
        <div className="verb-quiz-infinitive">
          <span>{word}</span>
          <SpeakButton text={word} lang={targetLanguage} size={16} />
        </div>
        {step.entry.example && (
          <p className="verb-quiz-translation">{step.entry.example}</p>
        )}

        <div className="noun-quiz-choices">
          {PREPOSITION_CASE_ORDER.map((option) => {
            const state = !revealed
              ? ""
              : option === step.answer
                ? " correct"
                : option === answered?.choice
                  ? " wrong"
                  : "";
            return (
              <button
                key={option}
                type="button"
                className={`noun-quiz-choice${state}`}
                disabled={revealed}
                onClick={() => choose(option)}
              >
                {CASE_LABEL[option]}
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
          <p className="noun-quiz-hint">{prepositionCaseHint(step.answer)}</p>
        )}
        {revealed && (
          <p className={`noun-quiz-explain${answered?.ok ? " ok" : " miss"}`}>
            <strong>{answered?.ok ? "Верно! " : `Правильный ответ — ${CASE_LABEL[step.answer]}. `}</strong>
            {prepositionCaseExplanation(word, step.answer)}
          </p>
        )}

        <div className="noun-quiz-actions">
          {index > 0 && (
            <button type="button" className="secondary-btn noun-quiz-back" onClick={previousItem}>
              <ChevronLeft size={16} /> Назад
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
