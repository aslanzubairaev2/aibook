"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, RotateCcw, Volume2, Ear, Mic, MicOff } from "lucide-react";
import type { Flashcard, ProductiveSkill, SkillProgress } from "@/lib/types";
import { calculateSM2, createDefaultSkillProgress, type SrsScore } from "@/lib/srs/sm2";
import { getCardSkillState, saveCardSkillProgress } from "@/lib/db/local";
import { speak } from "@/lib/tts";
import { startRecognition, isSpeechRecognitionSupported, type Recognizer } from "@/lib/speech/recognition";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { SkillBadges } from "@/components/cards/SkillBadges";

type Props = {
  cards: Flashcard[];
  targetLanguage: string;
  onReviewed?: (card: Flashcard) => void;
};

type QueueItem = { card: Flashcard; skill: ProductiveSkill };

const SKILLS: ProductiveSkill[] = ["recall", "listen", "produce"];
const SKILL_LABEL: Record<ProductiveSkill, string> = {
  recall: "Вспоминаю",
  listen: "Слушаю",
  produce: "Говорю",
};
const SKILL_PROMPT: Record<ProductiveSkill, string> = {
  recall: "Напишите это на изучаемом языке",
  listen: "Прослушайте и напишите, что услышали",
  produce: "Произнесите вслух, затем оцените себя",
};
const SESSION_CAP = 18;

function endOfTodayMs(): number {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function isSkillDue(p?: SkillProgress): boolean {
  return !p || p.status === "new" || new Date(p.dueAt).getTime() <= endOfTodayMs();
}

function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:"'»«()\-–—]/g, "")
    .replace(/\s+/g, " ");
}

// Round-robin across the three skills so the session stays varied.
function buildQueue(cards: Flashcard[]): QueueItem[] {
  const perSkill: Record<ProductiveSkill, QueueItem[]> = { recall: [], listen: [], produce: [] };
  for (const card of cards) {
    const state = getCardSkillState(card.id);
    for (const skill of SKILLS) {
      if (isSkillDue(state[skill])) perSkill[skill].push({ card, skill });
    }
  }
  const out: QueueItem[] = [];
  let added = true;
  while (added && out.length < SESSION_CAP) {
    added = false;
    for (const skill of SKILLS) {
      const q = perSkill[skill];
      if (q.length) {
        out.push(q.shift()!);
        added = true;
        if (out.length >= SESSION_CAP) break;
      }
    }
  }
  return out;
}

export function ProductiveTrainer({ cards, targetLanguage, onReviewed }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>(() => buildQueue(cards));
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [correct, setCorrect] = useState<boolean | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [listening, setListening] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const voiceSupported = isSpeechRecognitionSupported();

  const item = queue[index];
  const done = index >= queue.length;

  function stopVoice() {
    recognizerRef.current?.stop();
    recognizerRef.current = null;
    setListening(false);
  }

  function toggleVoice() {
    if (listening) { stopVoice(); return; }
    const rec = startRecognition(targetLanguage, {
      onResult: (t) => setInput(t),
      onEnd: () => setListening(false),
      onError: () => setListening(false),
    });
    if (rec) { recognizerRef.current = rec; setListening(true); }
  }

  // Stop any active recognition when the component unmounts.
  useEffect(() => () => { recognizerRef.current?.stop(); }, []);

  // For a "listen" item, auto-play the audio when it appears; focus the input.
  useEffect(() => {
    if (!item) return;
    stopVoice();
    if (item.skill === "listen" && !revealed) {
      void speak(item.card.front, targetLanguage);
    }
    if (item.skill !== "produce" && !revealed) {
      inputRef.current?.focus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Enter advances once an answer is shown (and grades a "produce" item directly).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !item) return;
      if (item.skill === "produce") { e.preventDefault(); grade(3); return; }
      if (revealed) { e.preventDefault(); grade(gaveUp || !correct ? 1 : 3); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item, revealed, correct, gaveUp]);

  function restart() {
    setQueue(buildQueue(cards));
    setIndex(0);
    setInput("");
    setRevealed(false);
    setCorrect(null);
  }

  function check() {
    if (!item) return;
    stopVoice();
    const ok = normalizeAnswer(input) === normalizeAnswer(item.card.front);
    setCorrect(ok);
    setGaveUp(false);
    setRevealed(true);
    void speak(item.card.front, targetLanguage);
  }

  // "Не знаю" — reveal the answer and mark it as forgotten.
  function dontKnow() {
    if (!item) return;
    stopVoice();
    setCorrect(false);
    setGaveUp(true);
    setRevealed(true);
    void speak(item.card.front, targetLanguage);
  }

  function grade(score: SrsScore) {
    if (!item) return;
    stopVoice();
    const prev = getCardSkillState(item.card.id)[item.skill] ?? createDefaultSkillProgress();
    const upd = calculateSM2(score, prev.repetitions, prev.lapses, prev.intervalDays, prev.easeFactor);
    saveCardSkillProgress(item.card.id, item.skill, { ...upd, lastReviewedAt: new Date().toISOString() });
    onReviewed?.(item.card);
    setInput("");
    setRevealed(false);
    setCorrect(null);
    setGaveUp(false);
    setIndex((i) => i + 1);
  }

  const styleBlock = (
    <style>{`
      .pt-wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; }
      .pt-head { width: 100%; max-width: 460px; display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text-muted); font-weight: 700; }
      .pt-skill-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--accent); font-size: 12px; font-weight: 800; }
      .pt-card { width: 100%; max-width: 460px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: var(--bg-elevated); padding: 20px 18px; display: flex; flex-direction: column; gap: 14px; min-height: 180px; }
      .pt-prompt { font-size: 11px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted); display: flex; align-items: center; gap: 8px; }
      .pt-cue { font-size: 24px; font-weight: 800; text-align: center; line-height: 1.25; word-break: break-word; padding: 6px 0; }
      .pt-cue.muted { color: var(--surface-dim); }
      .pt-listen-orb { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 12px 0; color: var(--accent); }
      .pt-input { width: 100%; padding: 12px 14px; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--bg-card); color: var(--text-primary); font-size: 18px; text-align: center; outline: none; font-family: var(--font-reading); }
      .pt-input:focus { border-color: var(--accent); }
      .pt-input.ok { border-color: var(--green); }
      .pt-input.bad { border-color: #e08888; }
      .pt-answer-row { display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 22px; font-weight: 800; }
      .pt-answer-row .pt-correct { color: var(--green); }
      .pt-your { font-size: 13px; color: var(--text-muted); text-align: center; }
      .pt-your s { color: #e08888; }
      .pt-meaning { font-size: 14px; color: var(--surface-dim); text-align: center; }
      .pt-actions { width: 100%; max-width: 460px; display: flex; gap: 8px; }
      .pt-btn { flex: 1; padding: 12px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-primary); font-weight: 700; font-size: 14px; cursor: pointer; transition: all 0.18s; }
      .pt-btn:active { transform: scale(0.97); }
      .pt-btn.primary { border-color: var(--accent); color: var(--accent); background: rgba(212,168,71,0.1); }
      .pt-btn.ghost { color: var(--text-muted); }
      .pt-self-grade { width: 100%; max-width: 460px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
      .pt-input-row { display: flex; gap: 8px; align-items: center; }
      .pt-input-row .pt-input { flex: 1; }
      .pt-mic { flex-shrink: 0; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-strong); border-radius: var(--radius-md); background: var(--bg-card); color: var(--text-muted); cursor: pointer; transition: all 0.18s; }
      .pt-mic:hover { color: var(--accent); border-color: var(--accent); }
      .pt-mic.live { color: #e08888; border-color: #e08888; background: rgba(224, 136, 136, 0.12); animation: pt-pulse 1.2s ease-in-out infinite; }
      @keyframes pt-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
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

  if (done) {
    return (
      <div className="pt-wrap">
        {styleBlock}
        <div className="empty-state" style={{ background: "linear-gradient(135deg, rgba(122, 171, 106, 0.08) 0%, var(--bg-elevated) 100%)", borderColor: "rgba(122, 171, 106, 0.2)" }}>
          <CheckCircle2 size={48} style={{ color: "var(--green)" }} />
          <strong>Сессия завершена!</strong>
          <p>Вы воспроизвели {queue.length} упражнений. Прогресс по навыкам сохранён.</p>
          <button className="secondary-btn" style={{ marginTop: 12 }} onClick={restart} type="button">
            <RotateCcw size={14} /> Ещё подход
          </button>
        </div>
      </div>
    );
  }

  const card = item.card;
  const showInput = item.skill !== "produce";

  return (
    <div className="pt-wrap">
      {styleBlock}

      <div className="pt-head">
        <span>Упражнение {index + 1} из {queue.length}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <SkillBadges cardId={card.id} />
          <span className="pt-skill-chip">{SKILL_LABEL[item.skill]}</span>
        </span>
      </div>

      <div className="pt-card">
        <div className="pt-prompt">
          {item.skill === "listen" ? <Ear size={13} /> : item.skill === "produce" ? <Volume2 size={13} /> : null}
          {SKILL_PROMPT[item.skill]}
        </div>

        {/* Cue */}
        {item.skill === "recall" && <div className="pt-cue">{card.back}</div>}

        {item.skill === "listen" && !revealed && (
          <div className="pt-listen-orb">
            <SpeakButton text={card.front} lang={targetLanguage} size={26} />
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Нажмите, чтобы повторить</span>
          </div>
        )}

        {item.skill === "produce" && (
          <>
            <div className="pt-cue">
              {card.front} <SpeakButton text={card.front} lang={targetLanguage} size={18} />
            </div>
            <div className="pt-meaning">{card.back}</div>
          </>
        )}

        {/* Input for recall / listen — typed or spoken */}
        {showInput && !revealed && (
          <div className="pt-input-row">
            <input
              ref={inputRef}
              className="pt-input"
              value={input}
              placeholder={listening ? "Говорите…" : "Ваш ответ…"}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && input.trim()) check(); }}
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

        {/* Result for recall / listen */}
        {showInput && revealed && (
          <>
            <input className={`pt-input ${correct ? "ok" : "bad"}`} value={input} readOnly />
            <div className="pt-answer-row">
              <span className={correct ? "pt-correct" : ""} style={!correct ? { color: "var(--accent)" } : undefined}>
                {card.front}
              </span>
              <SpeakButton text={card.front} lang={targetLanguage} size={16} />
            </div>
            <div className="pt-meaning">{card.back}</div>
          </>
        )}
      </div>

      {/* Action area */}
      {showInput && !revealed && (
        <div className="pt-actions">
          <button className="pt-btn ghost" onClick={dontKnow} type="button">Не знаю</button>
          <button className="pt-btn primary" onClick={check} type="button" disabled={!input.trim()}>
            Проверить
          </button>
        </div>
      )}

      {showInput && revealed && (
        correct ? (
          <div className="pt-actions">
            <button className="pt-btn" onClick={() => grade(4)} type="button">Легко</button>
            <button className="pt-btn primary" onClick={() => grade(3)} type="button">Дальше →</button>
          </div>
        ) : gaveUp ? (
          <div className="pt-actions">
            <button className="pt-btn primary" onClick={() => grade(1)} type="button">Дальше →</button>
          </div>
        ) : (
          <div className="pt-actions">
            <button className="pt-btn ghost" onClick={() => grade(3)} type="button">Я был прав</button>
            <button className="pt-btn primary" onClick={() => grade(1)} type="button">Дальше →</button>
          </div>
        )
      )}

      {/* Self-grade for produce */}
      {item.skill === "produce" && (
        <div className="pt-self-grade">
          <button className="grade-btn grade-btn-1" onClick={() => grade(1)} type="button">
            <span className="grade-score">1</span><span className="grade-lbl">Не смог</span>
          </button>
          <button className="grade-btn grade-btn-2" onClick={() => grade(2)} type="button">
            <span className="grade-score">2</span><span className="grade-lbl">Трудно</span>
          </button>
          <button className="grade-btn grade-btn-3" onClick={() => grade(3)} type="button">
            <span className="grade-score">3</span><span className="grade-lbl">Хорошо</span>
          </button>
          <button className="grade-btn grade-btn-4" onClick={() => grade(4)} type="button">
            <span className="grade-score">4</span><span className="grade-lbl">Легко</span>
          </button>
        </div>
      )}
    </div>
  );
}
