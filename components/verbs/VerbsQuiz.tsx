"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { checkTypedAnswer, type AnswerVerdict } from "@/lib/srs/activeTraining";
import { SpeakButton } from "@/components/ui/SpeakButton";

type Props = {
  verbs: DictionaryEntry[];
  targetLanguage: string;
  onExit: () => void;
};

type FieldKey = "praeteritum" | "partizip2";
type FieldResult = { verdict: AnswerVerdict; expected: string };
type EmptyInputs = Record<FieldKey, string>;

const FIELD_LABEL: Record<FieldKey, string> = {
  praeteritum: "Präteritum",
  partizip2: "Partizip II",
};

const EMPTY_INPUTS: EmptyInputs = { praeteritum: "", partizip2: "" };
const EMPTY_RESULTS: Record<FieldKey, FieldResult | null> = { praeteritum: null, partizip2: null };

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Session-only self-test: cover Präteritum and Partizip II, try to recall
 * them, check. Deliberately not wired into the SM-2 flashcard schedule — this
 * is a drill on top of the dictionary the learner already has, not a second
 * spaced-repetition track for the same words.
 */
export function VerbsQuiz({ verbs, targetLanguage, onExit }: Props) {
  const [queue, setQueue] = useState<DictionaryEntry[]>(() => shuffle(verbs));
  const [index, setIndex] = useState(0);
  const [inputs, setInputs] = useState<EmptyInputs>(EMPTY_INPUTS);
  const [revealed, setRevealed] = useState(false);
  const [results, setResults] = useState(EMPTY_RESULTS);
  const [mistakes, setMistakes] = useState<DictionaryEntry[]>([]);
  const [correctCount, setCorrectCount] = useState(0);

  const entry = queue[index];
  const done = index >= queue.length;

  const fields = useMemo<FieldKey[]>(() => {
    if (!entry) return [];
    return (["praeteritum", "partizip2"] as FieldKey[]).filter((f) => Boolean(entry.forms?.[f]));
  }, [entry]);

  function submit() {
    if (!entry || revealed) return;
    const next = { ...EMPTY_RESULTS };
    let allGood = true;
    for (const f of fields) {
      const expected = entry.forms[f];
      const check = checkTypedAnswer(inputs[f], expected);
      next[f] = { verdict: check.verdict, expected };
      if (check.verdict === "wrong") allGood = false;
    }
    setResults(next);
    setRevealed(true);
    if (allGood) setCorrectCount((c) => c + 1);
    else setMistakes((m) => [...m, entry]);
  }

  function nextItem() {
    setRevealed(false);
    setInputs(EMPTY_INPUTS);
    setResults(EMPTY_RESULTS);
    setIndex((i) => i + 1);
  }

  function retryMistakes() {
    setQueue(shuffle(mistakes));
    setMistakes([]);
    setCorrectCount(0);
    setIndex(0);
    setRevealed(false);
    setInputs(EMPTY_INPUTS);
    setResults(EMPTY_RESULTS);
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

  if (!entry) return null;

  return (
    <section className="screen verbs-view verb-quiz">
      <header className="screen-header">
        <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад">
          <ArrowLeft size={20} />
        </button>
        <div>
          <p className="eyebrow">Глаголы · тренировка</p>
          <h1>{index + 1} / {queue.length}</h1>
        </div>
      </header>

      <div className="verb-quiz-card">
        <div className="verb-quiz-infinitive">
          <span>{entry.headword}</span>
          <SpeakButton text={entry.headword} lang={targetLanguage} size={16} />
        </div>
        {entry.translation && <p className="verb-quiz-translation">{entry.translation}</p>}

        {fields.map((f) => {
          const result = results[f];
          return (
            <div key={f} className="verb-quiz-field">
              <label htmlFor={`verb-quiz-${f}`}>{FIELD_LABEL[f]}</label>
              <input
                id={`verb-quiz-${f}`}
                type="text"
                value={inputs[f]}
                disabled={revealed}
                onChange={(e) => setInputs((prev) => ({ ...prev, [f]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (revealed) nextItem();
                  else submit();
                }}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                className={`verb-quiz-input${revealed && result ? ` ${result.verdict}` : ""}`}
              />
              {revealed && result?.verdict === "wrong" && (
                <span className="verb-quiz-expected">{result.expected}</span>
              )}
            </div>
          );
        })}

        {!revealed ? (
          <button type="button" className="primary-btn" onClick={submit}>Проверить</button>
        ) : (
          <button type="button" className="primary-btn" onClick={nextItem}>Далее</button>
        )}
      </div>
    </section>
  );
}
