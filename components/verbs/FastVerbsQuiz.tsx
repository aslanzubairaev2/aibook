"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Loader2, Mic, MicOff, RotateCcw, X } from "lucide-react";
import type { DictionaryEntry } from "@/lib/db/dictionaryStore";
import { checkTypedAnswer, diffExpected } from "@/lib/srs/activeTraining";
import { fetchConjugationFields } from "@/lib/verbs/conjugationFields";
import { allFieldsPass, isFullyMatched, matchFastFields, stripPronouns, tokenize, type FastField, type FastFieldResult } from "@/lib/verbs/fastMatch";
import { isSpeechRecognitionSupported, startContinuousRecognition } from "@/lib/speech/recognition";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { CONJUGATION_TENSE_ORDER, QUIZ_MODE_LABEL, type ConjugationTense, type QuizMode } from "@/lib/verbsQuizModes";

type Props = {
  verbs: DictionaryEntry[];
  targetLanguage: string;
  nativeLanguage: string;
  modes: Set<QuizMode>;
  conjugationTenses: Set<ConjugationTense>;
  onExit: () => void;
  onRecord?: (entryId: string, correct: boolean) => void;
};

// The fast drill is voice-only and asks every selected mode in one breath —
// it does not (yet) know how to fold a generated example sentence into that,
// so "Фразы" sits out of it, same as the caller is told up front.
const FAST_MODES: QuizMode[] = ["translation", "forms", "conjugation"];

type FastStep = {
  key: string;
  entry: DictionaryEntry;
  translationField: FastField | null;
  baseGermanFields: FastField[];
  needsConjugation: boolean;
  /** null = not fetched yet (only meaningful when needsConjugation is true). */
  conjugationFields: FastField[] | null;
};

function shuffle<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function germanFieldsOf(step: FastStep): FastField[] | null {
  if (!step.needsConjugation) return step.baseGermanFields;
  if (step.conjugationFields === null) return null;
  return [...step.baseGermanFields, ...step.conjugationFields];
}

function allFieldsOf(step: FastStep): FastField[] | null {
  const german = germanFieldsOf(step);
  if (german === null) return null;
  return step.translationField ? [step.translationField, ...german] : german;
}

function buildFastQueue(verbs: DictionaryEntry[], modes: Set<QuizMode>): FastStep[] {
  return shuffle(verbs).flatMap((entry): FastStep[] => {
    const translationField = modes.has("translation") && entry.translation?.trim()
      ? { key: "translation", label: "Перевод", expected: entry.translation.trim() }
      : null;

    const baseGermanFields: FastField[] = [];
    if (modes.has("forms")) {
      if (entry.forms?.praeteritum) baseGermanFields.push({ key: "praeteritum", label: "Präteritum", expected: entry.forms.praeteritum });
      if (entry.forms?.partizip2) baseGermanFields.push({ key: "partizip2", label: "Partizip II", expected: entry.forms.partizip2 });
    }

    const needsConjugation = modes.has("conjugation");
    if (!translationField && baseGermanFields.length === 0 && !needsConjugation) return [];

    return [{ key: entry.id, entry, translationField, baseGermanFields, needsConjugation, conjugationFields: needsConjugation ? null : [] }];
  });
}

/**
 * Keeps a continuous recognizer alive for as long as the caller wants it —
 * the browser can end a "continuous" session on its own after a stretch of
 * silence well before every field has been said, so this restarts it behind
 * the scenes rather than leaving the mic looking like it stopped listening.
 */
function listenPersistently(lang: string, onFinal: (transcript: string) => void, onFatal: (message: string) => void) {
  let stopped = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let current: ReturnType<typeof startContinuousRecognition> = null;

  function start() {
    current = startContinuousRecognition(lang, {
      onFinal,
      onError: (message) => {
        if (stopped) return;
        if (message === "not-allowed" || message === "service-not-allowed") {
          stopped = true;
          onFatal("Доступ к микрофону запрещён — разрешите его в браузере.");
        }
        // Other errors (network hiccups, "no-speech" already filtered out by
        // the recognizer itself) are left to onEnd's restart below.
      },
      onEnd: () => {
        if (stopped) return;
        restartTimer = setTimeout(start, 150);
      },
    });
    if (!current) { stopped = true; onFatal("Голосовой ввод не поддерживается в этом браузере."); }
  }
  start();

  return {
    stop: () => {
      stopped = true;
      if (restartTimer) clearTimeout(restartTimer);
      current?.stop();
    },
  };
}

const CORRECT_FLASH_MS = 550;
const WRONG_FLASH_MS = 1600;

/**
 * The voice-only fast drill: one card per verb, every selected mode (minus
 * Фразы) asked in one breath, graded and advanced automatically — no taps,
 * no per-field microphone buttons. The microphone segment switches language
 * on its own between the Russian translation and the German forms/
 * conjugation, since the Web Speech API can only recognise one language per
 * segment; that switch is the one unavoidable pause; everything else about
 * moving from field to field and word to word happens without the learner
 * touching anything.
 */
export function FastVerbsQuiz({ verbs, targetLanguage, nativeLanguage, modes, conjugationTenses, onExit, onRecord }: Props) {
  const activeModes = useMemo(() => new Set(FAST_MODES.filter((m) => modes.has(m))), [modes]);
  const [queue, setQueue] = useState<FastStep[]>(() => buildFastQueue(verbs, activeModes));
  const [index, setIndex] = useState(0);
  const [correctCount, setCorrectCount] = useState(0);
  const [mistakes, setMistakes] = useState<FastStep[]>([]);
  const [verdict, setVerdict] = useState<"correct" | "wrong" | null>(null);
  const [liveResults, setLiveResults] = useState<(FastFieldResult | null)[]>([]);
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supported = useMemo(() => isSpeechRecognitionSupported(), []);

  const step = queue[index];
  const done = index >= queue.length;

  function advance() {
    setVerdict(null);
    setLiveResults([]);
    setIndex((i) => i + 1);
  }

  // Fetches this step's conjugation fields the moment it becomes current —
  // reuses the exact cache the grammar modal and the slow drill both fill.
  useEffect(() => {
    if (!step || !step.needsConjugation || step.conjugationFields !== null) return;
    let cancelled = false;
    const tenses = CONJUGATION_TENSE_ORDER.filter((t) => conjugationTenses.has(t));
    const entry = step.entry;
    const stepKey = step.key;
    (async () => {
      const perTense = await Promise.all(
        tenses.map((tense) => fetchConjugationFields(entry.lemma, entry.headword, tense, targetLanguage, nativeLanguage)),
      );
      if (cancelled) return;
      const fields = perTense.flat();
      setQueue((prev) => prev.map((s) => (s.key === stepKey ? { ...s, conjugationFields: fields } : s)));
    })();
    return () => { cancelled = true; };
  }, [step, conjugationTenses, targetLanguage, nativeLanguage]);

  // The listening/grading engine for the current step: starts as soon as its
  // fields are fully resolved, tears itself down on cleanup (step change,
  // unmount) so no stray recognizer keeps a background segment alive.
  useEffect(() => {
    if (!step || done) return;
    const fields = allFieldsOf(step);
    if (fields === null) return; // conjugation still loading

    if (fields.length === 0) {
      // Nothing left to ask once conjugation resolved (e.g. the AI call
      // failed) — skip past it rather than showing an empty card. Deferred a
      // tick so the advance doesn't set state synchronously inside the effect.
      let cancelled = false;
      void Promise.resolve().then(() => { if (!cancelled) advance(); });
      return () => { cancelled = true; };
    }

    let cancelled = false;
    let handle: { stop: () => void } | null = null;
    const germanFields = germanFieldsOf(step) ?? [];
    const germanTokens: string[] = [];

    function grade(translationResult: FastFieldResult | null, germanResults: FastFieldResult[]) {
      if (cancelled) return;
      cancelled = true;
      handle?.stop();
      const all = translationResult ? [translationResult, ...germanResults] : germanResults;
      const pass = allFieldsPass(all);
      setListening(false);
      setVerdict(pass ? "correct" : "wrong");
      setLiveResults(pass ? [] : all);
      onRecord?.(step.entry.id, pass);
      if (pass) setCorrectCount((c) => c + 1);
      else setMistakes((m) => [...m, step]);
      advanceTimerRef.current = setTimeout(advance, pass ? CORRECT_FLASH_MS : WRONG_FLASH_MS);
    }

    function startGerman(translationResult: FastFieldResult | null) {
      if (cancelled) return;
      if (germanFields.length === 0) {
        grade(translationResult, []);
        return;
      }
      setMicError(null);
      setListening(true);
      setLiveResults(translationResult ? [translationResult, ...germanFields.map(() => null)] : germanFields.map(() => null));
      handle = listenPersistently(
        targetLanguage,
        (chunk) => {
          if (cancelled) return;
          germanTokens.push(...stripPronouns(tokenize(chunk)));
          const matched = matchFastFields(germanTokens, germanFields);
          setLiveResults(translationResult ? [translationResult, ...matched] : matched);
          if (isFullyMatched(matched)) grade(translationResult, matched);
        },
        (message) => { if (!cancelled) setMicError(message); },
      );
    }

    function startTranslation() {
      setMicError(null);
      setListening(true);
      setLiveResults([null, ...germanFields.map(() => null)]);
      handle = listenPersistently(
        nativeLanguage,
        (chunk) => {
          if (cancelled) return;
          handle?.stop();
          const field = step.translationField!;
          const check = checkTypedAnswer(chunk, field.expected);
          const result: FastFieldResult = { key: field.key, label: field.label, expected: field.expected, given: chunk, verdict: check.verdict };
          startGerman(result);
        },
        (message) => { if (!cancelled) setMicError(message); },
      );
    }

    if (step.translationField) startTranslation();
    else startGerman(null);

    return () => {
      cancelled = true;
      handle?.stop();
      if (advanceTimerRef.current) { clearTimeout(advanceTimerRef.current); advanceTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.key, step && allFieldsOf(step)?.length, done]);

  function retryMistakes() {
    setQueue(shuffle(mistakes));
    setMistakes([]);
    setCorrectCount(0);
    setIndex(0);
    setVerdict(null);
    setLiveResults([]);
  }

  if (queue.length === 0) {
    return (
      <section className="screen verbs-view verb-quiz">
        <header className="screen-header">
          <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
          <div>
            <p className="eyebrow">Глаголы · быстрая тренировка</p>
            <h1>Нечего тренировать</h1>
          </div>
        </header>
        <div className="verb-quiz-summary">
          <p>Ни у одного слова нет данных для включённых режимов.</p>
          <button type="button" className="secondary-btn" onClick={onExit}>Назад</button>
        </div>
      </section>
    );
  }

  if (!supported) {
    return (
      <section className="screen verbs-view verb-quiz">
        <header className="screen-header">
          <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
          <div>
            <p className="eyebrow">Глаголы · быстрая тренировка</p>
            <h1>Голос не поддерживается</h1>
          </div>
        </header>
        <div className="verb-quiz-summary">
          <MicOff size={32} />
          <p>Этот браузер не умеет распознавать речь. Быстрая тренировка работает в Chrome и Edge — либо воспользуйтесь обычной тренировкой.</p>
          <button type="button" className="secondary-btn" onClick={onExit}>Назад</button>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section className="screen verbs-view verb-quiz">
        <header className="screen-header">
          <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
          <div>
            <p className="eyebrow">Глаголы · быстрая тренировка</p>
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

  const fields = allFieldsOf(step);
  const entry = step.entry;
  // The translation is shown as a hint only when it isn't itself one of the
  // fields being asked for — same rule the slow drill uses.
  const showTranslationHint = entry.translation && !step.translationField;

  return (
    <section className="screen verbs-view verb-quiz">
      <header className="screen-header">
        <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">
            Глаголы · быстрая тренировка · {[...activeModes].map((m) => QUIZ_MODE_LABEL[m]).join(" + ")}
          </p>
          <h1>{index + 1} / {queue.length}</h1>
        </div>
      </header>

      <div className={`verb-quiz-card fast-quiz-card${verdict ? ` verdict-${verdict}` : ""}`}>
        <div className="verb-quiz-infinitive">
          <span>{entry.headword}</span>
          <SpeakButton text={entry.headword} lang={targetLanguage} size={16} />
        </div>
        {showTranslationHint && <p className="verb-quiz-translation">{entry.translation}</p>}

        {fields === null ? (
          <div className="verb-quiz-loading"><Loader2 className="spin" size={18} /> Загружаю спряжение...</div>
        ) : (
          <div className="fast-quiz-fields">
            {fields.map((field, i) => {
              const result = liveResults[i];
              return (
                <div key={field.key} className="fast-quiz-field-box">
                  <label>{field.label}</label>
                  <div className={`fast-quiz-field-value${result ? ` ${result.verdict}` : ""}`}>
                    {verdict === "wrong" && result && result.verdict !== "correct" ? (
                      diffExpected(result.given, result.expected).map((seg, si) => (
                        <span key={si} className={seg.changed ? "verb-quiz-diff" : undefined}>{seg.text}</span>
                      ))
                    ) : (
                      result?.given || " "
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="fast-quiz-status">
          {micError ? (
            <span className="fast-quiz-mic-error"><MicOff size={14} /> {micError}</span>
          ) : verdict === "correct" ? (
            <span className="fast-quiz-verdict-icon correct"><Check size={18} /></span>
          ) : verdict === "wrong" ? (
            <span className="fast-quiz-verdict-icon wrong"><X size={18} /></span>
          ) : listening ? (
            <span className="fast-quiz-listening"><Mic size={14} className="fast-quiz-mic-pulse" /> Слушаю...</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
