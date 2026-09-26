"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronLeft } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { checkTypedAnswer, diffExpected, type AnswerVerdict } from "@/lib/srs/activeTraining";
import { ARTICLE_TYPE_LABEL, CASE_LABEL_FULL, adjectiveEnding, adjectiveEndingHint } from "@/lib/adjectiveEndings";
import { GENDER_LABEL, type NounGender } from "@/lib/nounForms";
import { ADJECTIVE_FRAMES_PER_WORD, randomAdjectiveFrame, shuffled, type AdjectiveFrame } from "@/lib/otherPosQuizModes";

type Props = {
  entries: DictionaryEntry[];
  nounsByGender: Record<NounGender, string[]>;
  onExit: () => void;
  /** Reports one answered frame so the pack's coverage bar can move. */
  onRecord: (entryId: string, correct: boolean) => void;
};

type AdjectiveStep = {
  key: string;
  entry: DictionaryEntry;
  frame: AdjectiveFrame;
  expected: string;
};

type AnsweredStep = { ok: boolean; input: string; verdict: AnswerVerdict };

function buildQueue(entries: DictionaryEntry[], nounsByGender: Record<NounGender, string[]>): AdjectiveStep[] {
  const steps = entries.flatMap((entry) =>
    Array.from({ length: ADJECTIVE_FRAMES_PER_WORD }, (_, i) => {
      const frame = randomAdjectiveFrame(nounsByGender);
      return {
        key: `${entry.id}:${i}`,
        entry,
        frame,
        expected: adjectiveEnding(frame.articleType, frame.grammCase, frame.gender),
      };
    }),
  );
  return shuffled(steps);
}

/**
 * Session-only self-test over the adjectives already in the learner's
 * dictionary: not "what does this word mean" but "what ending does it take
 * here" — a randomly generated case/gender/article frame per attempt, since
 * the ending is a grammatical fact about the sentence, not about the word.
 */
export function AdjectiveQuiz({ entries, nounsByGender, onExit, onRecord }: Props) {
  const [queue, setQueue] = useState<AdjectiveStep[]>(() => buildQueue(entries, nounsByGender));
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [mistakes, setMistakes] = useState<AdjectiveStep[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnsweredStep>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);

  const step = queue[index];
  const done = index >= queue.length;
  const answered = step ? answers[step.key] : undefined;
  const revealed = Boolean(answered);

  useEffect(() => {
    if (!revealed) inputRef.current?.focus();
  }, [step?.key, revealed]);

  useEffect(() => {
    if (revealed) primaryButtonRef.current?.focus();
  }, [revealed]);

  function submit() {
    if (!step || revealed) return;
    const check = checkTypedAnswer(draft, step.expected);
    const ok = check.verdict !== "wrong";
    setAnswers((prev) => ({ ...prev, [step.key]: { ok, input: draft, verdict: check.verdict } }));
    onRecord(step.entry.id, ok);
    if (ok) setCorrectCount((c) => c + 1);
    else setMistakes((m) => [...m, step]);
  }

  function goTo(next: number) {
    setDraft("");
    setIndex(next);
  }

  function nextItem() {
    goTo(index + 1);
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
            <p className="eyebrow">Прилагательные · тренировка</p>
            <h1>Нечего тренировать</h1>
          </div>
        </header>
        <div className="verb-quiz-summary">
          <p>В словаре пока нет прилагательных.</p>
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
            <p className="eyebrow">Прилагательные · тренировка</p>
            <h1>Готово</h1>
          </div>
        </header>
        <div className="verb-quiz-summary">
          <strong>{correctCount} из {queue.length} правильно</strong>
          {mistakes.length > 0 && (
            <button type="button" className="primary-btn" onClick={retryMistakes}>
              Повторить ошибки ({mistakes.length})
            </button>
          )}
          <button type="button" className="secondary-btn" onClick={onExit}>Готово</button>
        </div>
      </section>
    );
  }

  const word = (step.entry.lemma || step.entry.headword).toLowerCase();
  const { frame } = step;
  const result = answered ? { verdict: answered.verdict, expected: step.expected } : undefined;

  return (
    <section className="screen verbs-view verb-quiz noun-quiz">
      <header className="screen-header">
        <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Прилагательные · тренировка · Окончание</p>
          <h1>{index + 1} / {queue.length}</h1>
        </div>
      </header>

      <div className="verb-quiz-card">
        <p className="verb-quiz-translation">
          {CASE_LABEL_FULL[frame.grammCase]} · {GENDER_LABEL[frame.gender]} · {ARTICLE_TYPE_LABEL[frame.articleType]}
        </p>
        <div className="verb-quiz-phrase-prompt">
          {frame.article} {word}<u>___</u> {frame.noun}
        </div>

        <div className="verb-quiz-field">
          <label htmlFor="adjective-ending-input">Окончание</label>
          <div className="verb-quiz-input-row">
            <input
              id="adjective-ending-input"
              ref={inputRef}
              type="text"
              value={draft}
              disabled={revealed}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (revealed) nextItem();
                else submit();
              }}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className={`verb-quiz-input${revealed && result ? ` ${result.verdict}` : ""}`}
            />
          </div>
          {revealed && result && result.verdict !== "correct" && (
            <span className={`verb-quiz-expected ${result.verdict}`}>
              {diffExpected(answered?.input ?? "", result.expected).map((seg, si) => (
                <span key={si} className={seg.changed ? "verb-quiz-diff" : undefined}>{seg.text}</span>
              ))}
            </span>
          )}
        </div>

        {!revealed && (
          <p className="noun-quiz-hint">{adjectiveEndingHint(frame.articleType)}</p>
        )}
        {revealed && (
          <p className={`noun-quiz-explain${answered?.ok ? " ok" : " miss"}`}>
            <strong>{answered?.ok ? "Верно! " : `Правильно: ${word}${step.expected}. `}</strong>
            {frame.article} {word}{step.expected} {frame.noun}
          </p>
        )}

        <div className="noun-quiz-actions">
          {index > 0 && (
            <button type="button" className="secondary-btn noun-quiz-back" onClick={previousItem}>
              <ChevronLeft size={16} /> Назад
            </button>
          )}
          {!revealed ? (
            <button type="button" className="primary-btn" onClick={submit}>Проверить</button>
          ) : (
            <button type="button" ref={primaryButtonRef} className="primary-btn" onClick={nextItem}>Далее</button>
          )}
        </div>
      </div>
    </section>
  );
}
