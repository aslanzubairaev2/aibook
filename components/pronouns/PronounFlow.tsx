"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Delete, X } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { flushTrainingEvents, logTrainingEvent, newId } from "@/lib/training/client";
import { checkBlanks, checkSentence, type CheckResult } from "@/lib/pronouns/check";
import type { SessionSettings } from "@/lib/pronouns/config";
import { pronounEventInput } from "@/lib/pronouns/record";
import { TAP_COLUMNS, followUps, planSession, type PronounTask, type Role } from "@/lib/pronouns/tasks";

type FlowMode = "tap" | "build";

type Props = {
  mode: FlowMode;
  settings: SessionSettings;
  dueDifficulties: string[];
  /** A teacher's session has an end; the learner's own flow runs until they leave. */
  limit?: number;
  assignedSessionId?: string | null;
  title: string;
  onExit: () => void;
};

/** A right answer moves on by itself; a wrong one waits for a tap so it can be read. */
const ADVANCE_MS = 650;
const BATCH = 10;

function seedFrom(id: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Fast pronoun practice: a stream of short tasks answered with buttons.
 *
 * tap — the German sentence with both pronouns missing; a tap on a pronoun
 * fills the next blank. build — only the Russian is shown; the sentence is
 * put together from word buttons, a few of them deliberately wrong. Every
 * answer goes into the same history and is checked by the same rules as the
 * typed modes; a wrong one brings the same difficulty back a few tasks later.
 */
export function PronounFlow({ mode, settings, dueDifficulties, limit, assignedSessionId = null, title, onExit }: Props) {
  const [sessionId] = useState(newId);
  const flowSettings: SessionSettings = { ...settings, response_mode: mode, item_count: BATCH };
  const [tasks, setTasks] = useState<PronounTask[]>(() => planSession({
    settings: { ...flowSettings, item_count: limit ?? BATCH }, enabledModes: [mode], seed: seedFrom(sessionId, 0), newId, dueDifficulties,
  }));
  const [index, setIndex] = useState(0);
  const [filled, setFilled] = useState<Partial<Record<Role, string>>>({});
  const [nichtIn, setNichtIn] = useState(false); // tap: the «nicht» blank of a negation
  const [placed, setPlaced] = useState<number[]>([]); // build: bank indexes, in order
  const [result, setResult] = useState<CheckResult | null>(null);
  const [score, setScore] = useState({ right: 0, total: 0, streak: 0 });
  const [summary, setSummary] = useState(false);
  const shownAtRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const batchRef = useRef(1);

  const task = tasks[index];
  const finished = limit !== undefined && index >= tasks.length;

  useEffect(() => { shownAtRef.current = Date.now(); }, [index]);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  // The learner's own flow never runs dry: more tasks are drawn before the last one.
  useEffect(() => {
    if (limit !== undefined || index < tasks.length - 3) return;
    const more = planSession({ settings: flowSettings, enabledModes: [mode], seed: seedFrom(sessionId, batchRef.current++), newId, dueDifficulties: [] });
    setTasks((list) => [...list, ...more]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, tasks.length, limit]);

  useEffect(() => {
    if (!assignedSessionId) return;
    void postSession(assignedSessionId, "start");
  }, [assignedSessionId]);

  useEffect(() => {
    if (!finished) return;
    void flushTrainingEvents();
    if (assignedSessionId) void postSession(assignedSessionId, "complete");
  }, [finished, assignedSessionId]);

  const next = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    setIndex((i) => i + 1);
    setFilled({});
    setNichtIn(false);
    setPlaced([]);
    setResult(null);
  }, []);

  function finish(answer: string, check: CheckResult) {
    const ms = Date.now() - shownAtRef.current;
    logTrainingEvent(pronounEventInput(task, {
      sessionId, assignedSessionId, answer, outcome: check.outcome, result: check, attemptNo: 1, correctionOf: null,
      hintUsed: false, answerShown: false, activeMs: ms > 0 && ms < 30 * 60 * 1000 ? ms : null,
    }));
    setResult(check);
    const ok = check.outcome === "correct" || check.outcome === "typo";
    if (check.outcome !== "needs_review") setScore((s) => ({ right: s.right + (ok ? 1 : 0), total: s.total + 1, streak: ok ? s.streak + 1 : 0 }));
    if (ok) {
      timerRef.current = window.setTimeout(next, ADVANCE_MS);
    } else if (check.outcome === "incorrect" && !task.recheck_of) {
      // The same difficulty, on another verb, three tasks on.
      const { later } = followUps(task, flowSettings, [mode], seedFrom(task.id, 7), newId);
      if (later) setTasks((list) => { const copy = [...list]; copy.splice(Math.min(copy.length, index + 4), 0, later); return copy; });
    }
  }

  const negation = task?.sentenceType === "negation";

  // tap: a pronoun goes into the next empty pronoun blank, «nicht» into its own;
  // once every blank is filled, the answer is checked.
  function tap(word: string) {
    if (!task || result) return;
    const order: Role[] = task.tokens.filter((t) => t.slot === "S" || t.slot === "O").map((t) => (t.slot === "S" ? "subject" : "object"));
    let nextFilled = filled;
    let nextNicht = nichtIn;
    if (word === "nicht") {
      if (!negation || nichtIn) return;
      nextNicht = true;
      setNichtIn(true);
    } else {
      const role = order.find((r) => !filled[r]);
      if (!role) return;
      nextFilled = { ...filled, [role]: word };
      setFilled(nextFilled);
    }
    if (!order.every((r) => nextFilled[r]) || (negation && !nextNicht)) return;
    const check = checkBlanks(task, nextFilled);
    if (negation) check.components.negation = "correct";
    const answer = task.tokens.map((t) => (t.slot === "S" ? nextFilled.subject : t.slot === "O" ? nextFilled.object : t.text)).join(" ");
    finish(answer, check);
  }

  function unTap(role: Role) {
    if (result) return;
    setFilled((f) => { const c = { ...f }; delete c[role]; return c; });
  }

  // build: words go to the end of the line; the sentence is checked once it has as many words as it needs.
  function place(i: number) {
    if (!task || result || placed.includes(i)) return;
    const nextPlaced = [...placed, i];
    setPlaced(nextPlaced);
    if (nextPlaced.length === task.tokens.length) {
      const answer = nextPlaced.map((k) => task.bank![k]).join(" ");
      finish(answer, checkSentence(task, answer));
    }
  }

  function unplace(position: number) {
    if (result) return;
    setPlaced((p) => p.filter((_, k) => k !== position));
  }

  // Keyboard: digits pick a button, Backspace takes the last one back, Enter moves on.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!task || summary) return;
      if (e.key === "Enter" && result) { e.preventDefault(); next(); return; }
      if (result) return;
      if (e.key === "Backspace") {
        e.preventDefault();
        if (mode === "build") setPlaced((p) => p.slice(0, -1));
        else if (nichtIn) setNichtIn(false);
        else setFilled((f) => { const c = { ...f }; if (c.object) delete c.object; else delete c.subject; return c; });
        return;
      }
      if (mode === "tap" && e.key.toLowerCase() === "n") { e.preventDefault(); tap("nicht"); return; }
      const n = e.key === "0" ? 10 : Number(e.key);
      if (mode === "build" && Number.isInteger(n) && n >= 1 && task.bank && n <= task.bank.length) {
        e.preventDefault();
        place(n - 1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  function leave() {
    void flushTrainingEvents();
    if (score.total > 0 && !summary) setSummary(true);
    else onExit();
  }

  if (summary || finished || !task) {
    return (
      <section className="screen verbs-view verb-quiz">
        <Header title="Итог" eyebrow={title} onBack={onExit} />
        <div className="verb-quiz-summary">
          <strong>Верно: {score.right} из {score.total}</strong>
          <p className="verb-quiz-translation">Ошибки вернутся в следующих тренировках.</p>
          <button type="button" className="primary-btn" onClick={onExit}>Готово</button>
        </div>
      </section>
    );
  }

  const ok = result && (result.outcome === "correct" || result.outcome === "typo");
  const words = placed.map((k) => task.bank![k]);
  return (
    <section className="screen verbs-view verb-quiz pron-flow">
      <Header
        title={limit ? `${Math.min(index + 1, tasks.length)} / ${tasks.length}` : `${score.right} / ${score.total}`}
        eyebrow={`${title}${score.streak >= 3 ? ` · подряд ${score.streak}` : ""}`}
        onBack={leave}
      />
      <div className="verb-quiz-card">
        {task.recheck_of && <p className="pron-tag">Ещё раз то же различие</p>}
        {task.context_de && <p className="pron-context"><span>{task.context_de}</span> <span className="verb-quiz-translation">{task.context_ru}</span></p>}
        <p className="verb-quiz-phrase-prompt">{task.prompt_ru}</p>
        {task.notes_ru.length > 0 && <p className="pron-notes">{task.notes_ru.map((n) => `[${n}]`).join(" ")}</p>}

        {mode === "tap" ? (
          <p className="pron-frame pron-frame-big">
            {task.tokens.map((t, i) => {
              const role: Role | null = t.slot === "S" ? "subject" : t.slot === "O" ? "object" : null;
              const end = i === task.tokens.length - 1 ? (task.sentenceType === "question" ? "?" : ".") : "";
              const shown = (w: string) => (i === 0 ? cap(w) : w);
              if (t.slot === "NICHT") {
                return (
                  <span key={i}>
                    <button type="button" className={`pron-slot pron-slot-nicht${nichtIn ? " filled" : ""}${result ? " right" : ""}`} onClick={() => !result && setNichtIn(false)} aria-label="Отрицание">
                      {nichtIn ? "nicht" : "…"}
                    </button>{end}
                  </span>
                );
              }
              if (!role) return <span key={i}>{shown(t.text)}{end}</span>;
              const value = filled[role];
              const state = result ? (result.components[role] === "correct" ? " right" : " wrong") : "";
              return (
                <span key={i}>
                  <button type="button" className={`pron-slot${value ? " filled" : ""}${state}`} onClick={() => unTap(role)} aria-label={role === "subject" ? "Подлежащее" : "Дополнение"}>
                    {value ? shown(value) : "…"}
                  </button>{end}
                </span>
              );
            })}
          </p>
        ) : (
          <div className={`pron-build-line${result ? (ok ? " right" : " wrong") : ""}`} aria-label="Собранное предложение">
            {words.length === 0 && <span className="pron-build-placeholder">Нажимайте слова по порядку</span>}
            {words.map((w, k) => (
              <button key={k} type="button" className="pron-chip placed" onClick={() => unplace(k)}>{k === 0 ? cap(w) : w}</button>
            ))}
            {words.length > 0 && words.length === task.tokens.length && <span>{task.sentenceType === "question" ? "?" : "."}</span>}
          </div>
        )}

        {!result && mode === "tap" && (
          <div className="pron-keys" role="group" aria-label="Местоимения">
            {TAP_COLUMNS.map((c) => <span key={`ru-${c.ru}`} className="pron-key-label">{c.ru}</span>)}
            {TAP_COLUMNS.map((c, i) => (
              <button key={`n-${i}`} type="button" className="pron-key" onClick={() => tap(c.nom)} aria-label={`${c.nom} — ${c.ru}`}>{c.nom}</button>
            ))}
            {TAP_COLUMNS.map((c, i) => (
              <button key={`a-${i}`} type="button" className="pron-key" onClick={() => tap(c.acc)}>{c.acc}</button>
            ))}
            <button type="button" className="pron-key pron-key-nicht" onClick={() => tap("nicht")} disabled={!negation || nichtIn}>nicht</button>
          </div>
        )}

        {!result && mode === "build" && (
          <div className="pron-bank">
            {task.bank!.map((w, i) => (
              <button key={`${w}-${i}`} type="button" className="pron-chip" disabled={placed.includes(i)}
                onClick={() => place(i)}>
                {w}
              </button>
            ))}
            {placed.length > 0 && (
              <button type="button" className="pron-chip pron-chip-undo" onClick={() => setPlaced((p) => p.slice(0, -1))} aria-label="Убрать последнее слово"><Delete size={16} /></button>
            )}
          </div>
        )}

        {result && (
          <div className={`pron-feedback ${ok ? "correct" : result.outcome}`}>
            <strong className="pron-verdict">{ok ? <Check size={16} /> : <X size={16} />} {ok ? "Верно" : result.outcome === "needs_review" ? "Не удалось проверить" : "Не так"}</strong>
            {!ok && (
              <ul className="pron-feedback-lines">
                {result.feedback.filter((l) => !/^(Нужно|Целиком):/.test(l)).map((l, i) => <li key={i}>{l}</li>)}
              </ul>
            )}
            <p className="pron-expected"><span>{task.expected}</span><SpeakButton text={task.expected} lang="de" size={15} /></p>
            {!ok && <button type="button" className="primary-btn" onClick={next} autoFocus>Дальше</button>}
          </div>
        )}
      </div>
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

async function postSession(id: string, action: "start" | "complete") {
  try {
    const { sbAuthHeaders } = await import("@/lib/db/supabase");
    const headers = await sbAuthHeaders();
    await fetch(`/api/pronoun-practice/sessions/${id}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ action }) });
  } catch {
    // Status is cosmetic; the answers are in the history either way.
  }
}
