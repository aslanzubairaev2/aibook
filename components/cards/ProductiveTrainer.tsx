"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, RotateCcw, Ear, Mic, MicOff, PenLine, MessageSquare, Eye } from "lucide-react";
import type { Flashcard, ProductiveSkill, SkillProgress } from "@/lib/types";
import { calculateSM2, createDefaultSkillProgress, type SrsScore } from "@/lib/srs/sm2";
import { getCardSkillState, saveCardSkillProgress } from "@/lib/db/local";
import { speak } from "@/lib/tts";
import { startRecognition, isSpeechRecognitionSupported, type Recognizer } from "@/lib/speech/recognition";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { SkillBadges } from "@/components/cards/SkillBadges";
import { splitCardBack } from "@/lib/cards";
import {
  buildActiveQueue,
  checkTypedAnswer,
  formatInterval,
  previewIntervalDays,
  type ActiveItem,
  type AnswerVerdict,
} from "@/lib/srs/activeTraining";

type Props = {
  cards: Flashcard[];
  targetLanguage: string;
  onReviewed?: (card: Flashcard) => void;
};

const SKILL_LABEL: Record<ProductiveSkill, string> = {
  recall: "Письмо",
  listen: "На слух",
  produce: "Речь",
};

const TARGET_LABEL: Record<string, string> = {
  de: "по-немецки",
  en: "по-английски",
  fr: "по-французски",
  es: "по-испански",
  ru: "по-русски",
};

/** Every exercise states the task in one imperative line — no guessing what is wanted. */
function taskText(skill: ProductiveSkill, targetLanguage: string): string {
  const lang = TARGET_LABEL[targetLanguage] ?? "на изучаемом языке";
  if (skill === "recall") return `Напишите ${lang}`;
  if (skill === "listen") return "Послушайте и напишите услышанное";
  return `Скажите вслух ${lang}`;
}

/** The reveal state of one exercise: what the learner produced and how it scored. */
type Result = { verdict: AnswerVerdict | "self"; hint?: string; heard?: string };

export function ProductiveTrainer({ cards, targetLanguage, onReviewed }: Props) {
  const [queue, setQueue] = useState<ActiveItem[]>(() => buildActiveQueue(cards, getCardSkillState));
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const voiceSupported = isSpeechRecognitionSupported();

  const item = queue[index];
  const done = index >= queue.length;
  const card = item?.card;
  const skill = item?.skill;
  const back = useMemo(() => splitCardBack(card?.back ?? ""), [card?.back]);

  const progress: SkillProgress = item
    ? getCardSkillState(item.card.id)[item.skill] ?? createDefaultSkillProgress()
    : createDefaultSkillProgress();

  function stopVoice() {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    setListening(false);
  }

  // Reveal the answer. `verdict` is "self" when only the learner can judge —
  // a spoken answer with no recognition to compare against.
  const reveal = useCallback((next: Result) => {
    stopVoice();
    setResult(next);
    if (card) void speak(card.front, targetLanguage);
  }, [card, targetLanguage]);

  const submitTyped = useCallback((text: string) => {
    if (!card || !text.trim()) return;
    reveal(checkTypedAnswer(text, card.front));
  }, [card, reveal]);

  function toggleVoice() {
    if (listening) { stopVoice(); return; }
    const rec = startRecognition(targetLanguage, {
      onResult: (transcript) => {
        if (!card) return;
        if (skill === "produce") {
          // Recognition on single words is imperfect, so it informs the learner
          // instead of overruling them: the grade stays theirs.
          const check = checkTypedAnswer(transcript, card.front);
          reveal({ verdict: check.verdict === "wrong" ? "self" : check.verdict, hint: check.hint, heard: transcript });
        } else {
          setInput(transcript);
        }
      },
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
    if (rec) { recognizerRef.current = rec; setListening(true); }
  }

  useEffect(() => () => { recognizerRef.current?.stop(); }, []);

  // A fresh exercise: play the audio prompt for a listening item, focus the field.
  useEffect(() => {
    if (!item) return;
    stopVoice();
    if (item.skill === "listen") void speak(item.card.front, targetLanguage);
    if (item.skill !== "produce") inputRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  function restart() {
    setQueue(buildActiveQueue(cards, getCardSkillState));
    setIndex(0);
    setInput("");
    setResult(null);
  }

  const grade = useCallback((score: SrsScore) => {
    if (!item) return;
    stopVoice();
    const prev = getCardSkillState(item.card.id)[item.skill] ?? createDefaultSkillProgress();
    const upd = calculateSM2(score, prev.repetitions, prev.lapses, prev.intervalDays, prev.easeFactor);
    saveCardSkillProgress(item.card.id, item.skill, { ...upd, lastReviewedAt: new Date().toISOString() });
    onReviewed?.(item.card);
    setInput("");
    setResult(null);
    setIndex((i) => i + 1);
  }, [item, onReviewed]);

  // One Enter answers, the next Enter takes the primary (highlighted) action —
  // so a whole session can be finished from the keyboard without ambiguity.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !item) return;
      if (!result) {
        if (item.skill === "produce") { e.preventDefault(); reveal({ verdict: "self" }); }
        return;
      }
      e.preventDefault();
      grade(result.verdict === "correct" || result.verdict === "almost" ? 3 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, result, grade, reveal]);

  const styleBlock = (
    <style>{`
      .pt-wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .pt-head { width: 100%; max-width: 460px; display: flex; flex-direction: column; gap: 8px; }
      .pt-head-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-muted); font-weight: 700; }
      .pt-bar { height: 4px; border-radius: 99px; background: var(--bg-elevated); overflow: hidden; }
      .pt-bar span { display: block; height: 100%; background: var(--accent); transition: width 0.25s ease; }
      .pt-skill-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 99px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--accent); font-size: 11px; font-weight: 800; }
      .pt-card { width: 100%; max-width: 460px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--bg-elevated); padding: 18px; display: flex; flex-direction: column; gap: 14px; }
      .pt-task { font-size: 12px; font-weight: 800; color: var(--text-primary); text-align: center; }
      .pt-cue { font-size: 25px; font-weight: 800; text-align: center; line-height: 1.25; word-break: break-word; }
      .pt-sub { font-size: 13px; color: var(--text-muted); text-align: center; }
      .pt-input { width: 100%; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--bg-card); color: var(--text-primary); font-size: 18px; text-align: center; outline: none; font-family: var(--font-reading); }
      .pt-input:focus { border-color: var(--accent); }
      .pt-input-row { display: flex; gap: 8px; align-items: center; }
      .pt-input-row .pt-input { flex: 1; }
      .pt-mic { flex-shrink: 0; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--bg-card); color: var(--text-muted); cursor: pointer; transition: all 0.18s; }
      .pt-mic:hover { color: var(--accent); border-color: var(--accent); }
      .pt-mic.live { color: #e08888; border-color: #e08888; background: rgba(224, 136, 136, 0.12); animation: pt-pulse 1.2s ease-in-out infinite; }
      .pt-mic-big { width: 100%; height: 60px; gap: 10px; font-size: 14px; font-weight: 700; }
      @keyframes pt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
      .pt-listen { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 6px 0; color: var(--accent); }
      .pt-verdict { display: flex; align-items: center; justify-content: center; gap: 6px; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.06em; }
      .pt-verdict.ok { color: var(--green); }
      .pt-verdict.almost { color: var(--accent); }
      .pt-verdict.bad { color: #e08888; }
      .pt-given { text-align: center; font-size: 14px; color: var(--text-muted); }
      .pt-given s { color: #e08888; }
      .pt-answer { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 26px; font-weight: 800; color: var(--green); word-break: break-word; }
      .pt-answer.miss { color: var(--accent); }
      .pt-hint { text-align: center; font-size: 12px; color: var(--accent); }
      .pt-details { text-align: center; font-size: 12px; color: var(--surface-dim); white-space: pre-line; }
      .pt-actions { width: 100%; max-width: 460px; display: flex; gap: 8px; }
      .pt-btn { flex: 1; padding: 10px 8px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.18s; display: flex; flex-direction: column; align-items: center; gap: 2px; }
      .pt-btn:active { transform: scale(0.97); }
      .pt-btn:disabled { opacity: 0.45; cursor: default; }
      .pt-btn small { font-size: 10px; font-weight: 600; color: var(--text-muted); letter-spacing: 0.02em; }
      .pt-btn.primary { border-color: var(--accent); color: var(--accent); background: rgba(212,168,71,0.1); }
      .pt-btn.again { border-color: rgba(224, 136, 136, 0.35); color: #e08888; }
      .pt-btn.again small { color: rgba(224, 136, 136, 0.75); }
      .pt-btn.ghost { color: var(--text-muted); }
    `}</style>
  );

  if (queue.length === 0) {
    return (
      <div className="pt-wrap">
        {styleBlock}
        <div className="empty-state">
          <CheckCircle2 size={44} style={{ color: "var(--green)" }} />
          <strong>Активная практика выполнена</strong>
          <p>На сегодня нет упражнений на воспроизведение. Добавьте новые слова при чтении или вернитесь позже.</p>
        </div>
      </div>
    );
  }

  if (done || !item || !card || !skill) {
    return (
      <div className="pt-wrap">
        {styleBlock}
        <div className="empty-state" style={{ background: "linear-gradient(135deg, rgba(122, 171, 106, 0.08) 0%, var(--bg-elevated) 100%)", borderColor: "rgba(122, 171, 106, 0.2)" }}>
          <CheckCircle2 size={48} style={{ color: "var(--green)" }} />
          <strong>Сессия завершена!</strong>
          <p>Вы прошли {queue.length} упражнений. Прогресс по навыкам сохранён.</p>
          <button className="secondary-btn" style={{ marginTop: 12 }} onClick={restart} type="button">
            <RotateCcw size={14} /> Ещё подход
          </button>
        </div>
      </div>
    );
  }

  const typed = skill !== "produce";
  const good = result?.verdict === "correct";
  const almost = result?.verdict === "almost";

  /**
   * One row of grades. Each button says how well it went; the sub-label says
   * when the word comes back — but only when the options really do differ, so
   * the row never shows three buttons that all promise the same thing.
   */
  const gradeRow = (options: { label: string; score: SrsScore; tone?: string }[]) => {
    const days = options.map((option) => previewIntervalDays(option.score, progress));
    const showDays = days.length > 1 && new Set(days).size === days.length;
    return (
      <div className="pt-actions">
        {options.map((option, i) => (
          <button key={option.score} className={`pt-btn ${option.tone ?? ""}`} onClick={() => grade(option.score)} type="button">
            {option.label}
            {showDays && <small>{formatInterval(days[i])}</small>}
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="pt-wrap">
      {styleBlock}

      <div className="pt-head">
        <div className="pt-head-row">
          <span>{index + 1} / {queue.length}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <SkillBadges cardId={card.id} />
            <span className="pt-skill-chip">
              {skill === "listen" ? <Ear size={11} /> : skill === "produce" ? <MessageSquare size={11} /> : <PenLine size={11} />}
              {SKILL_LABEL[skill]}
            </span>
          </span>
        </div>
        <div className="pt-bar"><span style={{ width: `${(index / queue.length) * 100}%` }} /></div>
      </div>

      <div className="pt-card">
        <div className="pt-task">{taskText(skill, targetLanguage)}</div>

        {/* ── The question. The answer is always hidden until it is graded. ── */}
        {!result && (
          <>
            {skill === "listen" ? (
              <div className="pt-listen">
                <SpeakButton text={card.front} lang={targetLanguage} size={26} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Нажмите, чтобы повторить</span>
              </div>
            ) : (
              <div className="pt-cue">{back.meaning}</div>
            )}

            {typed && (
              <div className="pt-input-row">
                <input
                  ref={inputRef}
                  className="pt-input"
                  value={input}
                  placeholder={listening ? "Говорите…" : "Ваш ответ…"}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitTyped(input); } }}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {voiceSupported && (
                  <button
                    type="button"
                    className={`pt-mic ${listening ? "live" : ""}`}
                    onClick={toggleVoice}
                    aria-label="Ответить голосом"
                    title="Ответить голосом"
                  >
                    {listening ? <MicOff size={18} /> : <Mic size={18} />}
                  </button>
                )}
              </div>
            )}

            {skill === "produce" && voiceSupported && (
              <button
                type="button"
                className={`pt-mic pt-mic-big ${listening ? "live" : ""}`}
                onClick={toggleVoice}
              >
                {listening ? <MicOff size={20} /> : <Mic size={20} />}
                {listening ? "Слушаю…" : "Сказать и проверить"}
              </button>
            )}
          </>
        )}

        {/* ── The answer, with a verdict that explains itself. ── */}
        {result && (
          <>
            <div className={`pt-verdict ${good ? "ok" : almost ? "almost" : "bad"}`}>
              {good ? "Верно" : almost ? "Почти верно" : result.verdict === "self" ? "Правильный ответ" : "Не совпало"}
            </div>

            {(input.trim() || result.heard) && (
              <div className="pt-given">
                Вы {result.heard ? "сказали" : "написали"}:{" "}
                {result.verdict === "wrong" ? <s>{result.heard ?? input}</s> : <b>{result.heard ?? input}</b>}
              </div>
            )}

            <div className={`pt-answer ${good ? "" : "miss"}`}>
              {card.front}
              <SpeakButton text={card.front} lang={targetLanguage} size={16} />
            </div>

            {result.hint && <div className="pt-hint">{result.hint}</div>}
            <div className="pt-sub">{back.meaning}</div>
            {back.details && <div className="pt-details">{back.details}</div>}
          </>
        )}
      </div>

      {/* ── Actions. Before the answer: one way forward. After it: a single row
             of grades, shaped by what actually happened. ── */}
      {!result && typed && (
        <div className="pt-actions">
          <button className="pt-btn ghost" onClick={() => reveal({ verdict: "wrong" })} type="button">
            Не помню
          </button>
          <button className="pt-btn primary" onClick={() => submitTyped(input)} type="button" disabled={!input.trim()}>
            Проверить
          </button>
        </div>
      )}

      {!result && skill === "produce" && (
        <div className="pt-actions">
          <button className="pt-btn primary" onClick={() => reveal({ verdict: "self" })} type="button">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Eye size={14} /> Показать ответ</span>
          </button>
        </div>
      )}

      {/* Correct: the answer matched, so the only question left is how hard it felt. */}
      {good && gradeRow([
        { label: "Трудно", score: 2 },
        { label: "Хорошо", score: 3, tone: "primary" },
        { label: "Легко", score: 4 },
      ])}

      {/* Near miss: the hint above already said what was off, so the choice is
          only whether it counted. */}
      {almost && gradeRow([
        { label: "Повторить", score: 1, tone: "again" },
        { label: "Засчитать", score: 3, tone: "primary" },
      ])}

      {/* Missed it: one honest way forward, no arguing with the learner. */}
      {result?.verdict === "wrong" && gradeRow([
        { label: "Повторить", score: 1, tone: "primary again" },
      ])}

      {/* A spoken answer nothing could check automatically — the learner grades it. */}
      {result?.verdict === "self" && gradeRow([
        { label: "Не смог", score: 1, tone: "again" },
        { label: "Сказал верно", score: 3, tone: "primary" },
        { label: "Легко", score: 4 },
      ])}
    </div>
  );
}
