"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Check, Delete, Mic, RotateCcw, Send, Square, X } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { speak } from "@/lib/tts";
import { flushTrainingEvents, logTrainingEvent, newId } from "@/lib/training/client";
import { isSpeechRecognitionSupported, startRecognition, type Recognizer } from "@/lib/speech/recognition";
import { cap, seedFrom } from "@/lib/grammar/common";
import { planTasks, repeatTask, type GrammarConfig } from "@/lib/grammar/config";
import { grammarEventInput, type RecordOutcome } from "@/lib/grammar/record";
import { ERROR_LABEL, MODE_LABEL, checkQuick, checkSentence, quickGapOk, type CheckResult, type GrammarTask, type Mode, type TrainerId } from "@/lib/grammar/task";
import { CheatSheet } from "./CheatSheet";

type Props = {
  trainer: TrainerId;
  config: GrammarConfig;
  mode: Mode | "mixed";
  /** 0 = endless. */
  limit: number;
  due: string[];
  assignedSessionId: string | null;
  title: string;
  testRun: boolean;
  onExit: () => void;
};

/** Below this the recogniser itself is unsure: a technical question, not the learner's mistake. */
const LOW_CONFIDENCE = 0.55;
const BATCH = 6;
/** An error brings its construction back this many tasks later, with other words. */
const REPEAT_AFTER = 3;

type Phase = "answer" | "clarify" | "speech-check" | "feedback";
type Done = { task: GrammarTask; outcome: RecordOutcome; result: CheckResult | null; helped: boolean; corrected: RecordOutcome | null };

/** Wall-clock time; called from effects and event handlers only. */
function now(): number {
  return Date.now();
}

function errorLines(result: CheckResult): string[] {
  return result.feedback;
}

/**
 * One practice run of a grammar trainer, in any of its four modes.
 *
 * Endless by default: more tasks are drawn before the last one, and the
 * header counts what was done, never «0/0». A set of N keeps its N: repeats
 * after errors are shown apart. Every answer is logged at once; stopping at
 * any point shows a short summary.
 */
export function GrammarDrill({ trainer, config, mode, limit, due, assignedSessionId, title, testRun, onExit }: Props) {
  const speech = useMemo(() => isSpeechRecognitionSupported(), []);
  const [sessionId] = useState(newId);
  const [initial] = useState(() => planTasks(trainer, config, { mode, count: limit > 0 ? limit : BATCH, seed: seedFrom(sessionId, 0), newId, due, speech }));
  const [tasks, setTasks] = useState<GrammarTask[]>(initial);
  // Where the endless draw stands; read and moved on only from event handlers.
  const planRef = useRef<{ offset: number; batch: number; due: string[] } | null>(null);
  function drawMore(): GrammarTask[] {
    if (!planRef.current) planRef.current = { offset: initial.length, batch: 1, due: due.slice(initial.filter((t) => t.delayed_review).length) };
    const st = planRef.current;
    const more = planTasks(trainer, config, { mode, count: BATCH, seed: seedFrom(sessionId, st.batch++), newId, due: st.due, offset: st.offset, speech });
    st.due = st.due.slice(more.filter((t) => t.delayed_review).length);
    st.offset += more.length;
    return more;
  }
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("answer");
  const [text, setText] = useState("");
  const [gaps, setGaps] = useState<string[]>([]);
  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [helped, setHelped] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [details, setDetails] = useState(false);
  const [solutionShown, setSolutionShown] = useState(false);
  const [done, setDone] = useState<Done[]>([]);
  const [summary, setSummary] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<{ transcript: string; confidence: number | null; ms: number } | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const firstEventRef = useRef<string | null>(null);
  const shownAtRef = useRef(0);
  const recStartRef = useRef(0);
  const recognitionMsRef = useRef(0);
  const recognizerRef = useRef<Recognizer | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);

  const task = tasks[index];
  const finished = limit > 0 && index >= tasks.length;
  const mainTotal = limit > 0 ? tasks.filter((t) => !t.repeat_of).length : 0;
  const mainDone = tasks.slice(0, index).filter((t) => !t.repeat_of).length;
  const repeatsInSet = tasks.filter((t) => t.repeat_of).length;

  useEffect(() => {
    if (assignedSessionId) void postSession(trainer, assignedSessionId, "start");
  }, [assignedSessionId, trainer]);

  useEffect(() => {
    shownAtRef.current = now();
    recognitionMsRef.current = 0;
    if (task?.mode === "written") window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [index, task?.mode]);

  useEffect(() => () => recognizerRef.current?.stop(), []);

  useEffect(() => {
    if (!finished) return;
    void flushTrainingEvents();
    if (assignedSessionId) void postSession(trainer, assignedSessionId, "complete");
  }, [finished, assignedSessionId, trainer]);

  useEffect(() => { if (phase === "feedback") window.setTimeout(() => nextRef.current?.focus(), 30); }, [phase]);

  function activeMs(): number | null {
    const ms = now() - shownAtRef.current - recognitionMsRef.current;
    return ms > 0 && ms < 30 * 60 * 1000 ? ms : null;
  }

  function record(outcome: RecordOutcome, answer: string, check: CheckResult | null, extra: { answerShown?: boolean; technicalReason?: string } = {}) {
    const id = logTrainingEvent(grammarEventInput(task, {
      sessionId, assignedSessionId, answer, outcome, result: check,
      attemptNo: correcting ? 2 : 1, correctionOf: correcting ? firstEventRef.current : null,
      helpUsed: helped, answerShown: extra.answerShown ?? false, activeMs: activeMs(), testRun,
      speech: task.mode === "spoken" && heard ? { transcript: heard.transcript, confidence: heard.confidence, recognition_ms: heard.ms } : null,
      technicalReason: extra.technicalReason ?? null,
    }));
    if (!correcting) firstEventRef.current = id;
  }

  function scheduleRepeat() {
    if (task.repeat_of || correcting) return;
    const again = repeatTask(trainer, task, config, seedFrom(task.id, 3), newId);
    if (!again) return;
    const fixed = again.mode === "spoken" && !speech ? { ...again, mode: "written" as const } : again;
    setTasks((list) => { const copy = [...list]; copy.splice(Math.min(copy.length, index + 1 + REPEAT_AFTER), 0, fixed); return copy; });
  }

  function judge(answer: string): CheckResult {
    if (task.mode === "quick") return checkQuick(task, gaps);
    return checkSentence(task, answer, { spoken: task.mode === "spoken" });
  }

  function submit(answer: string, force = false) {
    if (!task) return;
    const check = judge(answer);
    if (check.outcome === "needs_review" && !force) {
      setResult(check);
      setPhase("clarify");
      return;
    }
    record(check.outcome, answer, check);
    setResult(check);
    setPhase("feedback");
    setDetails(false);
    if (check.outcome === "correct" || check.outcome === "typo") void speak(check.correction, "de").catch(() => undefined);
    if (correcting) {
      setDone((d) => d.map((x, i) => (i === d.length - 1 ? { ...x, corrected: check.outcome } : x)));
      return;
    }
    setDone((d) => [...d, { task, outcome: check.outcome, result: check, helped, corrected: null }]);
    if (check.outcome === "incorrect") scheduleRepeat();
  }

  function dontKnow() {
    record("dont_know", "", null, { answerShown: true });
    setResult({ outcome: "incorrect", issues: [], feedback: [], variant: 0, variant_note: null, uncertain_reason: null, correction: task.expected });
    setDone((d) => [...d, { task, outcome: "dont_know", result: null, helped, corrected: null }]);
    setSolutionShown(true);
    setDetails(true);
    setPhase("feedback");
    scheduleRepeat();
  }

  function nextTask() {
    // Endless: the next tasks are drawn before the last one is reached.
    if (limit === 0 && index + 1 >= tasks.length - 2) {
      const more = drawMore();
      if (more.length) setTasks((list) => [...list, ...more]);
    }
    setIndex((i) => i + 1);
    setPhase("answer");
    setText("");
    setGaps([]);
    setPlaced([]);
    setResult(null);
    setCorrecting(false);
    setHelped(false);
    setHeard(null);
    setSpeechError(null);
    setSolutionShown(false);
    setDetails(false);
    firstEventRef.current = null;
  }

  function startCorrection() {
    setCorrecting(true);
    setPhase("answer");
    setResult(null);
    setHeard(null);
    setGaps([]);
    setPlaced([]);
  }

  function openSheet() {
    // Help before the answer is part of the answer; looking it up afterwards is not.
    if (phase === "answer" && !correcting) setHelped(true);
    setSheet(true);
  }

  // ── Quick ──
  function tapKey(value: string) {
    if (!task?.quick || phase !== "answer") return;
    const slot = task.quick.gaps.findIndex((_, i) => !gaps[i]);
    if (slot < 0) return;
    const next = [...gaps];
    next[slot] = value;
    setGaps(next);
    if (task.quick.gaps.every((_, i) => next[i])) {
      const check = checkQuick(task, next);
      const answer = task.quick.frame.map((p) => ("gap" in p ? next[p.gap] : p.text)).join(" ").replace(/ ([.?])$/, "$1");
      record(check.outcome, answer, check);
      setResult(check);
      setPhase("feedback");
      if (check.outcome === "correct") void speak(task.expected, "de").catch(() => undefined);
      if (correcting) setDone((d) => d.map((x, i) => (i === d.length - 1 ? { ...x, corrected: check.outcome } : x)));
      else {
        setDone((d) => [...d, { task, outcome: check.outcome, result: check, helped, corrected: null }]);
        if (check.outcome === "incorrect") scheduleRepeat();
      }
    }
  }

  // ── Build ──
  const built = placed.map((k) => task?.bank?.[k] ?? "");

  // ── Speech ──
  function toggleMic() {
    if (listening) { recognizerRef.current?.stop(); return; }
    setSpeechError(null);
    recStartRef.current = now();
    const rec = startRecognition("de", {
      onResult: (transcript, confidence) => {
        const ms = now() - recStartRef.current;
        recognitionMsRef.current += ms;
        const h = { transcript, confidence: confidence ?? null, ms };
        setHeard(h);
        setText(transcript);
        if (h.confidence !== null && h.confidence < LOW_CONFIDENCE) setPhase("speech-check");
      },
      onError: (message) => {
        recognitionMsRef.current += now() - recStartRef.current;
        setListening(false);
        setSpeechError(message === "no-speech" ? "Ничего не расслышал." : message === "not-allowed" ? "Нет доступа к микрофону." : "Распознавание не сработало.");
        record("technical", "", null, { technicalReason: `speech:${message}` });
      },
      onEnd: () => setListening(false),
    });
    if (rec) { recognizerRef.current = rec; setListening(true); }
    else setSpeechError("Распознавание речи недоступно в этом браузере — ответьте текстом.");
  }

  function switchToWriting() {
    setTasks((list) => list.map((t, i) => (i === index ? { ...t, mode: "written" as const } : t)));
    setSpeechError(null);
    setHeard(null);
    setText("");
    setPhase("answer");
  }

  // Keyboard: Enter moves on after feedback; in build, Backspace takes the last word back.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (sheet || summary || !task) return;
      if (phase === "feedback" && e.key === "Enter" && (e.target as HTMLElement)?.tagName !== "BUTTON") { e.preventDefault(); nextTask(); return; }
      if (phase !== "answer") return;
      if (task.mode === "build" && e.key === "Backspace" && (e.target as HTMLElement)?.tagName !== "INPUT") { e.preventDefault(); setPlaced((p) => p.slice(0, -1)); }
      if (task.mode === "build" && e.key === "Enter" && placed.length) { e.preventDefault(); submit(built.join(" ")); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function leave() {
    recognizerRef.current?.stop();
    void flushTrainingEvents();
    if (done.length > 0 && !summary) setSummary(true);
    else onExit();
  }

  if (tasks.length === 0) {
    return (
      <section className="screen verbs-view verb-quiz">
        <Header title="Нечего тренировать" eyebrow={title} onBack={onExit} />
        <div className="verb-quiz-summary">
          <p>С этими настройками не получается составить ни одного задания. Откройте настройки — там написано, что именно мешает.</p>
          <button type="button" className="secondary-btn" onClick={onExit}>Назад</button>
        </div>
      </section>
    );
  }

  if (summary || finished || !task) return <Summary done={done} title={title} testRun={testRun} onExit={onExit} />;

  const headerTitle = limit > 0
    ? `${Math.min(mainDone + (task.repeat_of ? 0 : 1), mainTotal)} / ${mainTotal}`
    : `Выполнено: ${done.length}`;
  const eyebrow = [title, MODE_LABEL[task.mode], limit > 0 && repeatsInSet ? `+ повторов: ${repeatsInSet}` : null, testRun ? "ТЕСТ" : null].filter(Boolean).join(" · ");
  const ok = result && (result.outcome === "correct" || result.outcome === "typo");

  return (
    <section className="screen verbs-view verb-quiz pron-drill gr-drill">
      <header className="screen-header">
        <button className="icon-btn" onClick={leave} type="button" aria-label="Остановить"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{headerTitle}</h1>
        </div>
        <button type="button" className="gr-sheet-btn" onClick={openSheet} aria-label="Открыть шпаргалку"><BookOpen size={16} /> Шпаргалка</button>
      </header>

      <div className="verb-quiz-card">
        {(task.repeat_of || task.delayed_review) && <p className="pron-tag">{task.repeat_of ? "Повтор: та же конструкция, другие слова" : "Возвращаем прошлую трудность"}</p>}
        {task.quick && task.quick.instruction.map((line) => <p key={line} className="gr-instruction">{line}</p>)}
        <p className="verb-quiz-phrase-prompt">{task.prompt_ru}</p>
        {task.notes_ru.length > 0 && <p className="pron-notes">{task.notes_ru.map((n) => `[${n}]`).join(" ")}</p>}
        {task.word_hint && task.mode !== "quick" && <p className="gr-hint">{task.word_hint}</p>}

        {task.mode === "quick" && task.quick && (
          <p className="pron-frame pron-frame-big gr-frame">
            {task.quick.frame.map((p, i) => {
              if (!("gap" in p)) return <span key={i}>{p.text}</span>;
              const value = gaps[p.gap];
              const state = result ? (quickGapOk(task.quick!.gaps[p.gap], value ?? "") ? " right" : " wrong") : "";
              return (
                <button key={i} type="button" className={`pron-slot${value ? " filled" : ""}${state}`} disabled={phase !== "answer"}
                  onClick={() => setGaps((g) => { const c = [...g]; c[p.gap] = ""; return c; })} aria-label="Пропуск">
                  {value ? (value === "—" ? "∅" : value) : "…"}
                </button>
              );
            })}
          </p>
        )}

        {task.mode === "build" && (
          <div className={`pron-build-line${result ? (ok ? " right" : " wrong") : ""}`} aria-label="Собранное предложение">
            {built.length === 0 && <span className="pron-build-placeholder">Нажимайте слова по порядку — не все нужны</span>}
            {built.map((w, k) => (
              <button key={k} type="button" className="pron-chip placed" disabled={phase !== "answer"} onClick={() => setPlaced((p) => p.filter((_, j) => j !== k))}>{k === 0 ? cap(w) : w}</button>
            ))}
          </div>
        )}

        {phase === "answer" && (
          <>
            {task.mode === "quick" && task.quick && (
              <div className="gr-keys">
                {task.quick.keys.map((row, r) => (
                  <div key={r} className="gr-key-row">
                    {row.map((k) => (
                      <button key={k} type="button" className="pron-key" onClick={() => tapKey(k)}>{k === "—" ? "без предлога" : k}</button>
                    ))}
                  </div>
                ))}
              </div>
            )}
            {task.mode === "build" && task.bank && (
              <>
                <div className="pron-bank">
                  {task.bank.map((w, i) => (
                    <button key={`${w}-${i}`} type="button" className="pron-chip" disabled={placed.includes(i)} onClick={() => setPlaced((p) => [...p, i])}>{w}</button>
                  ))}
                  {placed.length > 0 && (
                    <button type="button" className="pron-chip pron-chip-undo" onClick={() => setPlaced((p) => p.slice(0, -1))} aria-label="Убрать последнее слово"><Delete size={16} /></button>
                  )}
                </div>
              </>
            )}
            {task.mode === "written" && (
              <form className="verb-quiz-input-row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) submit(text); }}>
                <input ref={inputRef} className="verb-quiz-input" value={text} onChange={(e) => setText(e.target.value)}
                  placeholder="Предложение по-немецки" autoCapitalize="sentences" autoCorrect="off" spellCheck={false} aria-label="Ответ" />
              </form>
            )}
            {task.mode === "spoken" && (
              <div className="pron-speech">
                <button type="button" className={`pron-mic${listening ? " listening" : ""}`} onClick={toggleMic} aria-label={listening ? "Остановить запись" : "Записать ответ"}>
                  {listening ? <Square size={22} /> : <Mic size={24} />}
                </button>
                <span className="pron-speech-label">{listening ? "Говорите…" : heard ? `Распознано: «${heard.transcript}»` : "Нажмите и скажите предложение по-немецки"}</span>
                {speechError && <span className="pron-speech-error">{speechError}</span>}
                {speechError && <button type="button" className="secondary-btn" onClick={switchToWriting}>Ответить текстом</button>}
              </div>
            )}
            <div className="pron-actions">
              {task.mode !== "quick" && (
                <button type="button" className="primary-btn" disabled={listening || (task.mode === "build" ? placed.length === 0 : !text.trim())}
                  onClick={() => submit(task.mode === "build" ? built.join(" ") : text)}>
                  <Send size={15} style={{ marginRight: 6 }} /> Проверить
                </button>
              )}
              {!correcting && <button type="button" className="secondary-btn" onClick={dontKnow}>Не знаю</button>}
              {helped && <span className="gr-helped">со шпаргалкой</span>}
            </div>
          </>
        )}

        {phase === "speech-check" && heard && (
          <div className="pron-clarify">
            <p>Распознано неуверенно: «{heard.transcript}». Это техническая неопределённость — в ошибки не пойдёт.</p>
            <div className="pron-actions">
              <button type="button" className="primary-btn" onClick={() => setPhase("answer")}>Да, я так и сказал</button>
              <button type="button" className="secondary-btn" onClick={() => {
                record("technical", heard.transcript, null, { technicalReason: "speech:low_confidence" });
                setHeard(null); setText(""); setPhase("answer");
              }}>Записать ещё раз</button>
            </div>
          </div>
        )}

        {phase === "clarify" && result && (
          <div className="pron-clarify">
            <p>{result.uncertain_reason}</p>
            <div className="pron-actions">
              {task.mode === "spoken"
                ? <button type="button" className="primary-btn" onClick={() => { record("technical", text, null, { technicalReason: "speech:unrecognised_words" }); setHeard(null); setText(""); setPhase("answer"); }}>Сказать ещё раз</button>
                : <button type="button" className="primary-btn" onClick={() => setPhase("answer")}>Исправить ответ</button>}
              {task.mode === "spoken" && <button type="button" className="secondary-btn" onClick={() => { record("technical", text, null, { technicalReason: "speech:unrecognised_words" }); switchToWriting(); }}>Ответить текстом</button>}
              <button type="button" className="secondary-btn" onClick={() => submit(task.mode === "build" ? built.join(" ") : text, true)}>Отправить на проверку</button>
            </div>
          </div>
        )}

        {phase === "feedback" && result && (
          <div className={`pron-feedback ${solutionShown ? "incorrect" : result.outcome}`}>
            <strong className="pron-verdict">
              {ok ? <Check size={16} /> : <X size={16} />}{" "}
              {solutionShown ? "Решение" : result.outcome === "correct" ? "Верно" : result.outcome === "typo" ? "Верно, с опечаткой" : result.outcome === "needs_review" ? "Отправлено на проверку" : correcting ? "Пока не так" : "Есть ошибка"}
            </strong>
            {!ok && result.issues.length > 0 && (
              <ul className="pron-components">
                {[...new Set(result.issues.map((i) => i.type))].map((t) => <li key={t} className={t === "typo" ? "typo" : "error"}>{ERROR_LABEL[t]}</li>)}
              </ul>
            )}
            {(!ok || result.outcome === "typo") && errorLines(result).length > 0 && (
              <ul className="pron-feedback-lines">{errorLines(result).map((l, i) => <li key={i}>{l}</li>)}</ul>
            )}
            {ok && result.feedback.length > 0 && result.outcome === "correct" && (
              <ul className="pron-feedback-lines">{result.feedback.map((l, i) => <li key={i}>{l}</li>)}</ul>
            )}
            <p className="pron-expected"><span>{result.correction}</span><SpeakButton text={result.correction} lang="de" size={15} /></p>
            {details && <ul className="gr-explain">{task.explain.map((l, i) => <li key={i}>{l}</li>)}</ul>}
          </div>
        )}

        {phase === "feedback" && (
          <div className="pron-actions">
            {result && result.outcome === "incorrect" && !correcting && !solutionShown && (
              <button type="button" className="secondary-btn" onClick={startCorrection}><RotateCcw size={15} style={{ marginRight: 6 }} /> Исправить</button>
            )}
            {!details && <button type="button" className="secondary-btn" onClick={() => setDetails(true)}>Разбор</button>}
            <button ref={nextRef} type="button" className="primary-btn" onClick={nextTask}>Дальше</button>
          </div>
        )}
      </div>

      {sheet && <CheatSheet trainer={trainer} onClose={() => setSheet(false)} />}
    </section>
  );
}

function Header({ title, eyebrow, onBack }: { title: string; eyebrow: string; onBack: () => void }) {
  return (
    <header className="screen-header">
      <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
    </header>
  );
}

function Summary({ done, title, testRun, onExit }: { done: Done[]; title: string; testRun: boolean; onExit: () => void }) {
  const judged = done.filter((d) => d.outcome !== "needs_review" && d.outcome !== "technical");
  const right = judged.filter((d) => d.outcome === "correct" || d.outcome === "typo");
  const independentRight = right.filter((d) => !d.helped).length;
  const types = new Map<string, number>();
  for (const d of done) for (const t of new Set(d.result?.issues.filter((i) => i.type !== "typo").map((i) => i.type) ?? [])) types.set(t, (types.get(t) ?? 0) + 1);
  const misses = done.filter((d) => d.outcome === "incorrect" || d.outcome === "dont_know");
  return (
    <section className="screen verbs-view verb-quiz">
      <Header title="Итог" eyebrow={`${title}${testRun ? " · ТЕСТ, не в статистике" : ""}`} onBack={onExit} />
      <div className="verb-quiz-summary pron-summary">
        <strong>Выполнено: {done.length} · верно с первого раза: {right.length}</strong>
        {right.length !== independentRight && <p className="verb-quiz-translation">Из них самостоятельно: {independentRight}, со шпаргалкой: {right.length - independentRight}</p>}
        {types.size > 0 && (
          <ul className="pron-summary-parts">
            {[...types].sort((a, b) => b[1] - a[1]).map(([t, n]) => <li key={t}><span>{ERROR_LABEL[t as keyof typeof ERROR_LABEL] ?? t}</span><b>{n}</b></li>)}
          </ul>
        )}
        {misses.length > 0 && (
          <ul className="pron-summary-misses">
            {misses.slice(-8).map((d, i) => (
              <li key={i}>
                <span>{d.task.prompt_ru}</span>
                <b>{d.task.expected}</b>
                {d.corrected && <em>{d.corrected === "correct" || d.corrected === "typo" ? "исправлено" : "исправление неверно"}</em>}
              </li>
            ))}
          </ul>
        )}
        {misses.length > 0 && <p className="verb-quiz-translation">Эти конструкции вернутся в следующих тренировках — с другими словами.</p>}
        {done.some((d) => d.outcome === "needs_review") && <p className="verb-quiz-translation">Неуверенно проверенные ответы ждут преподавателя и в ошибки не засчитаны.</p>}
        <button type="button" className="primary-btn" onClick={onExit}>Готово</button>
      </div>
    </section>
  );
}

async function postSession(trainer: TrainerId, id: string, action: "start" | "complete") {
  try {
    const { sbAuthHeaders } = await import("@/lib/db/supabase");
    const headers = await sbAuthHeaders();
    await fetch(`/api/grammar-trainers/${trainer}/sessions/${id}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ action }) });
  } catch {
    // The answers are in the history either way; the session's status is cosmetic.
  }
}
