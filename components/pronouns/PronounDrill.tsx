"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Lightbulb, Mic, RotateCcw, Send, Square, X } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { flushTrainingEvents, logTrainingEvent, newId } from "@/lib/training/client";
import { isSpeechRecognitionSupported, startRecognition, type Recognizer } from "@/lib/speech/recognition";
import { MODE_LABEL, PRONOUNS, type ResponseMode } from "@/lib/pronouns/catalog";
import { COMPONENT_LABEL, checkBlanks, checkSentence, type CheckResult, type Component } from "@/lib/pronouns/check";
import type { SessionSettings } from "@/lib/pronouns/config";
import { pronounEventInput, type RecordOutcome } from "@/lib/pronouns/record";
import { followUps, planSession, type PronounTask, type Role } from "@/lib/pronouns/tasks";

type Props = {
  settings: SessionSettings;
  enabledModes: ResponseMode[];
  dueDifficulties: string[];
  assignedSessionId: string | null;
  title: string;
  onExit: () => void;
  onFinished?: () => void;
};

/** Below this the recogniser itself is unsure: a technical question, not the learner's mistake. */
const LOW_CONFIDENCE = 0.55;
/** Follow-ups after errors may lengthen a session by at most this many tasks. */
const MAX_EXTRA = 6;

type Phase = "answer" | "clarify" | "speech-check" | "feedback";

type Done = { task: PronounTask; outcome: RecordOutcome; result: CheckResult | null; corrected: RecordOutcome | null };

const VISIBLE: Component[] = ["subject", "object", "conjugation", "sentence_type", "word_order", "government", "separable_prefix", "negation", "spelling"];

function roleHint(task: PronounTask, role: Role): string {
  return role === "subject"
    ? "Кто действует — подлежащее, Nominativ: ich · du · er · sie · wir · ihr · sie · Sie"
    : "На кого направлено — дополнение, Akkusativ: mich · dich · ihn · sie · es · uns · euch · sie · Sie";
}

/** The German sentence with the hidden pronouns as blanks (or inputs). */
function Frame({ task, values, onChange, onEnter, firstInputRef, disabled, inputs }: {
  task: PronounTask; values: Partial<Record<Role, string>>; onChange?: (role: Role, v: string) => void; onEnter?: () => void;
  firstInputRef?: React.RefObject<HTMLInputElement | null>; disabled?: boolean; inputs: boolean;
}) {
  const firstHidden = task.tokens.findIndex((t) => (t.slot === "S" && task.blanks.includes("subject")) || (t.slot === "O" && task.blanks.includes("object")));
  const slots = task.tokens.map((t, i) => {
    const role: Role | null = t.slot === "S" ? "subject" : t.slot === "O" ? "object" : null;
    const hidden = role && task.blanks.includes(role);
    const text = i === 0 ? t.text[0].toUpperCase() + t.text.slice(1) : t.text;
    const end = i === task.tokens.length - 1 ? (task.sentenceType === "question" ? "?" : ".") : "";
    if (!hidden) return <span key={i}>{text}{end}</span>;
    if (inputs) {
      return (
        <input
          key={i}
          ref={i === firstHidden ? firstInputRef : undefined}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter?.(); } }}
          className="verb-quiz-input pron-blank-input"
          value={values[role!] ?? ""}
          onChange={(e) => onChange?.(role!, e.target.value)}
          disabled={disabled}
          aria-label={role === "subject" ? "Подлежащее" : "Дополнение"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      );
    }
    return <span key={i}><span className={`pron-blank${values[role!] ? " filled" : ""}`}>{values[role!] || "___"}</span>{end}</span>;
  });
  return <p className="pron-frame">{slots}</p>;
}

export function PronounDrill({ settings, enabledModes, dueDifficulties, assignedSessionId, title, onExit, onFinished }: Props) {
  const speech = useMemo(() => isSpeechRecognitionSupported(), []);
  const [sessionId] = useState(newId);
  const [tasks, setTasks] = useState<PronounTask[]>(() => planSession({
    settings, enabledModes, seed: seedFrom(sessionId), newId, dueDifficulties, speechAvailable: speech,
  }));
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("answer");
  const [text, setText] = useState("");
  const [blanks, setBlanks] = useState<Partial<Record<Role, string>>>({});
  const [result, setResult] = useState<CheckResult | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [done, setDone] = useState<Done[]>([]);
  const [extra, setExtra] = useState(0);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<{ transcript: string; confidence: number | null; ms: number } | null>(null);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [notesSeen, setNotesSeen] = useState<Set<string>>(new Set());
  const [solutionShown, setSolutionShown] = useState(false);
  const firstEventRef = useRef<string | null>(null);
  const shownAtRef = useRef(0); // set when each task appears
  const recStartRef = useRef(0);
  const recognitionMsRef = useRef(0);
  const recognizerRef = useRef<Recognizer | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const startedRef = useRef(false);

  const task = tasks[index];
  const finished = index >= tasks.length;
  const hintsAllowed = settings.hints_before_first_answer || correcting;
  const governmentNote = task?.government_note && !notesSeen.has(task.verb) ? task.government_note : null;

  useEffect(() => {
    if (startedRef.current || !assignedSessionId) return;
    startedRef.current = true;
    void postSession(assignedSessionId, "start");
  }, [assignedSessionId]);

  useEffect(() => {
    shownAtRef.current = Date.now();
    recognitionMsRef.current = 0;
    if (task && (task.mode === "written" || task.mode === "gaps")) window.setTimeout(() => inputRef.current?.focus(), 30);
  }, [index, task]);

  useEffect(() => () => recognizerRef.current?.stop(), []);

  useEffect(() => {
    if (!finished) return;
    void flushTrainingEvents();
    if (assignedSessionId) void postSession(assignedSessionId, "complete");
    onFinished?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function activeMs(): number | null {
    const ms = Date.now() - shownAtRef.current - recognitionMsRef.current;
    return ms > 0 && ms < 30 * 60 * 1000 ? ms : null;
  }

  function record(outcome: RecordOutcome, answer: string, check: CheckResult | null, extraArgs: { technicalReason?: string; answerShown?: boolean } = {}) {
    const correctionOf = correcting ? firstEventRef.current : null;
    const id = logTrainingEvent(pronounEventInput(task, {
      sessionId, assignedSessionId, answer, outcome, result: check,
      attemptNo: correcting ? 2 : 1, correctionOf,
      hintUsed: hintOpen, answerShown: extraArgs.answerShown ?? false, activeMs: activeMs(),
      speech: task.mode === "spoken" && heard ? { transcript: heard.transcript, confidence: heard.confidence, recognition_ms: heard.ms } : null,
      technicalReason: extraArgs.technicalReason ?? null,
    }));
    if (!correcting) firstEventRef.current = id;
  }

  function judge(answer: string): CheckResult {
    return task.mode === "choice" || task.mode === "gaps"
      ? checkBlanks(task, task.mode === "choice" ? { [task.blanks[0]]: answer } : blanks)
      : checkSentence(task, answer, { spoken: task.mode === "spoken" });
  }

  function submit(answer: string, forceReview = false) {
    if (!task) return;
    const check = judge(answer);
    if (check.outcome === "needs_review" && !forceReview) {
      setResult(check);
      setPhase("clarify");
      return;
    }
    record(check.outcome, answer, check);
    setResult(check);
    setPhase("feedback");
    if (correcting) {
      setDone((d) => d.map((x, i) => (i === d.length - 1 ? { ...x, corrected: check.outcome } : x)));
      return;
    }
    setDone((d) => [...d, { task, outcome: check.outcome, result: check, corrected: null }]);
    if (check.outcome === "incorrect") scheduleFollowUps();
  }

  function dontKnow() {
    if (!task) return;
    record("dont_know", "", null, { answerShown: true });
    setResult({ outcome: "incorrect", components: {}, confusions: [], error_kind: null, agreement_ok: null, answered: { subject: null, object: null, verb: null, sentence_type: null }, feedback: [`Нужно: ${task.expected}`], uncertain_reason: null });
    setDone((d) => [...d, { task, outcome: "dont_know", result: null, corrected: null }]);
    setSolutionShown(true);
    setPhase("feedback");
    scheduleFollowUps();
  }

  function scheduleFollowUps() {
    // A follow-up's own error does not breed more follow-ups.
    if (task.followup_of || task.recheck_of || extra >= MAX_EXTRA) return;
    const { now, later } = followUps(task, settings, enabledModes, Date.now() % 2147483647, newId);
    const fixMode = (t: PronounTask | null) => (t && t.mode === "spoken" && !speech ? { ...t, mode: "written" as const } : t);
    setTasks((list) => {
      const next = [...list];
      const n = fixMode(now), l = fixMode(later);
      if (n) next.splice(index + 1, 0, n);
      if (l) next.splice(Math.min(next.length, index + (n ? 5 : 4)), 0, l);
      return next;
    });
    setExtra((e) => e + 2);
  }

  function nextTask() {
    if (task?.government_note) setNotesSeen((s) => new Set(s).add(task.verb));
    setIndex((i) => i + 1);
    setPhase("answer");
    setText("");
    setBlanks({});
    setResult(null);
    setHintOpen(false);
    setCorrecting(false);
    setHeard(null);
    setSpeechError(null);
    setSolutionShown(false);
    firstEventRef.current = null;
  }

  function startCorrection() {
    setCorrecting(true);
    setPhase("answer");
    setResult(null);
    setHeard(null);
    if (task.mode === "choice") setBlanks({});
  }

  /** The microphone failed: this task becomes a written one, and is recorded as written. */
  function switchToWriting() {
    setTasks((list) => list.map((t, i) => (i === index ? { ...t, mode: "written" as const } : t)));
    setSpeechError(null);
    setHeard(null);
    setText("");
    window.setTimeout(() => inputRef.current?.focus(), 30);
  }

  // ── Speech ──
  function toggleMic() {
    if (listening) { recognizerRef.current?.stop(); return; }
    setSpeechError(null);
    recStartRef.current = Date.now();
    const rec = startRecognition("de", {
      onResult: (transcript, confidence) => {
        const ms = Date.now() - recStartRef.current;
        recognitionMsRef.current += ms;
        const h = { transcript, confidence: confidence ?? null, ms };
        setHeard(h);
        setText(transcript);
        if (h.confidence !== null && h.confidence < LOW_CONFIDENCE) setPhase("speech-check");
      },
      onError: (message) => {
        recognitionMsRef.current += Date.now() - recStartRef.current;
        setListening(false);
        // No speech heard, no microphone: technical, logged apart, never an error.
        setSpeechError(message === "no-speech" ? "Ничего не расслышал." : message === "not-allowed" ? "Нет доступа к микрофону." : "Распознавание не сработало.");
        logTrainingEvent(pronounEventInput(task, {
          sessionId, assignedSessionId, answer: "", outcome: "technical", result: null, attemptNo: correcting ? 2 : 1,
          correctionOf: null, hintUsed: hintOpen, answerShown: false, activeMs: null, technicalReason: `speech:${message}`,
        }));
      },
      onEnd: () => setListening(false),
    });
    if (rec) { recognizerRef.current = rec; setListening(true); }
    else setSpeechError("Распознавание речи недоступно в этом браузере — ответьте текстом.");
  }

  if (tasks.length === 0) {
    return (
      <section className="screen verbs-view verb-quiz">
        <Header title="Нечего тренировать" eyebrow={title} onExit={onExit} />
        <div className="verb-quiz-summary">
          <p>С этими настройками не получается составить ни одного задания: включите ещё глаголы или блоки.</p>
          <button type="button" className="secondary-btn" onClick={onExit}>Назад</button>
        </div>
      </section>
    );
  }

  if (finished) return <Summary done={done} title={title} onExit={onExit} />;

  const isBlankMode = task.mode === "choice" || task.mode === "gaps";
  const canSubmit = task.mode === "gaps" ? task.blanks.every((r) => (blanks[r] ?? "").trim()) : text.trim().length > 0;

  return (
    <section className="screen verbs-view verb-quiz pron-drill">
      <Header title={`${Math.min(index + 1, tasks.length)} / ${tasks.length}`} eyebrow={`${title} · ${MODE_LABEL[task.mode]}`} onExit={onExit} />

      <div className="verb-quiz-card">
        {(task.delayed_review || task.recheck_of || task.followup_of) && (
          <p className="pron-tag">{task.followup_of ? "Ещё раз то же различие" : task.recheck_of ? "Проверка через несколько заданий" : "Повторение прошлой трудности"}</p>
        )}
        {governmentNote && <p className="pron-note">{governmentNote}</p>}
        {task.context_de && (
          <p className="pron-context"><span>{task.context_de}</span> <span className="verb-quiz-translation">{task.context_ru}</span></p>
        )}
        <p className="verb-quiz-phrase-prompt">{task.prompt_ru}</p>
        {task.notes_ru.length > 0 && <p className="pron-notes">{task.notes_ru.map((n) => `[${n}]`).join(" ")}</p>}

        {isBlankMode && (
          <Frame
            task={task}
            values={task.mode === "choice" ? (phase === "feedback" || phase === "clarify" ? { [task.blanks[0]]: text } : {}) : blanks}
            onChange={(role, v) => setBlanks((b) => ({ ...b, [role]: v }))}
            onEnter={() => { if (canSubmit) submit(""); }}
            firstInputRef={inputRef}
            disabled={phase !== "answer"}
            inputs={task.mode === "gaps"}
          />
        )}

        {phase === "answer" && (
          <>
            {task.mode === "choice" && (
              <div className="noun-quiz-choices">
                {task.options!.map((o) => (
                  <button key={o} type="button" className="noun-quiz-choice" onClick={() => { setText(o); submit(o); }}>{o}</button>
                ))}
              </div>
            )}
            {task.mode === "written" && (
              <form className="verb-quiz-input-row" onSubmit={(e) => { e.preventDefault(); if (canSubmit) submit(text); }}>
                <input
                  ref={inputRef}
                  className="verb-quiz-input"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Предложение по-немецки"
                  autoCapitalize="sentences"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-label="Ответ"
                />
              </form>
            )}
            {task.mode === "spoken" && (
              <div className="pron-speech">
                <button type="button" className={`pron-mic${listening ? " listening" : ""}`} onClick={toggleMic} aria-label={listening ? "Остановить запись" : "Записать ответ"}>
                  {listening ? <Square size={22} /> : <Mic size={24} />}
                </button>
                <span className="pron-speech-label">{listening ? "Говорите…" : heard ? `Распознано: «${heard.transcript}»` : "Нажмите и скажите предложение по-немецки"}</span>
                {speechError && <span className="pron-speech-error">{speechError}</span>}
                {speechError && (
                  <button type="button" className="secondary-btn" onClick={switchToWriting}>Ответить текстом</button>
                )}
              </div>
            )}

            <div className="pron-actions">
              {task.mode !== "choice" && (
                <button type="button" className="primary-btn" disabled={!canSubmit || listening} onClick={() => submit(task.mode === "gaps" ? "" : text)}>
                  <Send size={15} style={{ marginRight: 6 }} /> Проверить
                </button>
              )}
              {!correcting && (
                <button type="button" className="secondary-btn" onClick={dontKnow}>Не знаю</button>
              )}
              {hintsAllowed && (
                <button type="button" className={`noun-quiz-hint-toggle${hintOpen ? " active" : ""}`} onClick={() => setHintOpen((v) => !v)} aria-expanded={hintOpen}>
                  <Lightbulb size={14} /> Подсказка
                </button>
              )}
            </div>
            {hintOpen && <p className="noun-quiz-hint">{roleHint(task, task.focus_role)}</p>}
          </>
        )}

        {phase === "speech-check" && heard && (
          <div className="pron-clarify">
            <p>Распознано неуверенно: «{heard.transcript}». Это техническая неопределённость — в ошибки не пойдёт.</p>
            <div className="pron-actions">
              <button type="button" className="primary-btn" onClick={() => setPhase("answer")}>Да, я так и сказал</button>
              <button type="button" className="secondary-btn" onClick={() => {
                logTrainingEvent(pronounEventInput(task, {
                  sessionId, assignedSessionId, answer: heard.transcript, outcome: "technical", result: null, attemptNo: correcting ? 2 : 1,
                  correctionOf: null, hintUsed: hintOpen, answerShown: false, activeMs: null,
                  speech: { transcript: heard.transcript, confidence: heard.confidence, recognition_ms: heard.ms }, technicalReason: "speech:low_confidence",
                }));
                setHeard(null); setText(""); setPhase("answer");
              }}>Записать ещё раз</button>
            </div>
          </div>
        )}

        {phase === "clarify" && result && (
          <div className="pron-clarify">
            <p>{result.uncertain_reason}</p>
            <div className="pron-actions">
              <button type="button" className="primary-btn" onClick={() => setPhase("answer")}>Исправить ответ</button>
              <button type="button" className="secondary-btn" onClick={() => submit(task.mode === "gaps" ? "" : text, true)}>Отправить на проверку</button>
            </div>
          </div>
        )}

        {phase === "feedback" && result && (
          <Feedback task={task} result={result} correcting={correcting} solutionShown={solutionShown} />
        )}

        {phase === "feedback" && (
          <div className="pron-actions">
            {result && result.outcome === "incorrect" && !correcting && !solutionShown && (
              <button type="button" className="secondary-btn" onClick={startCorrection}><RotateCcw size={15} style={{ marginRight: 6 }} /> Исправить</button>
            )}
            <button type="button" className="primary-btn" onClick={nextTask} autoFocus>Дальше</button>
          </div>
        )}
      </div>
    </section>
  );
}

function Header({ title, eyebrow, onExit }: { title: string; eyebrow: string; onExit: () => void }) {
  return (
    <header className="screen-header">
      <button className="icon-btn" onClick={onExit} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
    </header>
  );
}

function Feedback({ task, result, correcting, solutionShown }: { task: PronounTask; result: CheckResult; correcting: boolean; solutionShown: boolean }) {
  const shown = VISIBLE.filter((c) => result.components[c]);
  const verdict = solutionShown ? "Решение" : result.outcome === "correct" ? "Верно" : result.outcome === "typo" ? "Верно, с опечаткой" : result.outcome === "needs_review" ? "Отправлено на проверку" : correcting ? "Пока не так" : "Есть ошибка";
  return (
    <div className={`pron-feedback ${result.outcome}`}>
      <strong className="pron-verdict">{result.outcome === "correct" || result.outcome === "typo" ? <Check size={16} /> : <X size={16} />} {verdict}</strong>
      {shown.length > 0 && (
        <ul className="pron-components" aria-label="Проверка по частям">
          {shown.map((c) => (
            <li key={c} className={result.components[c]}>{result.components[c] === "correct" ? "✓" : result.components[c] === "typo" ? "~" : "✗"} {COMPONENT_LABEL[c]}</li>
          ))}
        </ul>
      )}
      {result.feedback.some((line) => !/^(Нужно|Целиком):/.test(line)) && (
        <ul className="pron-feedback-lines">
          {result.feedback.filter((line) => !/^(Нужно|Целиком):/.test(line)).map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
      <p className="pron-expected">
        <span>{task.expected}</span>
        <SpeakButton text={task.expected} lang="de" size={15} />
      </p>
      {task.government_note && <p className="pron-note">{task.government_note}</p>}
      {(result.outcome === "incorrect") && task.focus_role && (
        <p className="pron-rule">{task.focus_role === "object"
          ? `${PRONOUNS[task.object].ruAcc} → ${PRONOUNS[task.object].acc}: на кого направлено действие — Akkusativ.`
          : `${PRONOUNS[task.subject].ruNom} → ${PRONOUNS[task.subject].nom}: кто действует — Nominativ.`}</p>
      )}
    </div>
  );
}

function Summary({ done, title, onExit }: { done: Done[]; title: string; onExit: () => void }) {
  const judged = done.filter((d) => d.outcome !== "needs_review" && d.outcome !== "technical");
  const right = judged.filter((d) => d.outcome === "correct" || d.outcome === "typo").length;
  const part = (c: Component) => {
    const with_ = done.filter((d) => d.result?.components[c]);
    return { n: with_.length, ok: with_.filter((d) => d.result!.components[c] !== "error").length };
  };
  const rows: Component[] = ["subject", "object", "conjugation", "word_order"];
  const misses = done.filter((d) => d.outcome === "incorrect" || d.outcome === "dont_know");
  return (
    <section className="screen verbs-view verb-quiz">
      <Header title="Готово" eyebrow={title} onExit={onExit} />
      <div className="verb-quiz-summary pron-summary">
        <strong>С первого раза: {right} из {judged.length}</strong>
        <ul className="pron-summary-parts">
          {rows.map((c) => { const p = part(c); return p.n ? <li key={c}><span>{COMPONENT_LABEL[c]}</span><b>{p.ok} / {p.n}</b></li> : null; })}
        </ul>
        {misses.length > 0 && (
          <ul className="pron-summary-misses">
            {misses.map((d, i) => (
              <li key={i}>
                <span>{d.task.prompt_ru}</span>
                <b>{d.task.expected}</b>
                {d.corrected && <em>{d.corrected === "correct" || d.corrected === "typo" ? "исправлено" : "исправление неверно"}</em>}
              </li>
            ))}
          </ul>
        )}
        {done.some((d) => d.outcome === "needs_review") && <p className="verb-quiz-translation">Неуверенно проверенные ответы ждут преподавателя и в ошибки не засчитаны.</p>}
        <button type="button" className="primary-btn" onClick={onExit}>Готово</button>
      </div>
    </section>
  );
}

/** A session's random seed, from its id: stable for the session, different for the next. */
function seedFrom(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

async function postSession(id: string, action: "start" | "complete") {
  try {
    const { sbAuthHeaders } = await import("@/lib/db/supabase");
    const headers = await sbAuthHeaders();
    await fetch(`/api/pronoun-practice/sessions/${id}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ action }) });
  } catch {
    // The session's answers are in the history either way; its status is cosmetic.
  }
}
