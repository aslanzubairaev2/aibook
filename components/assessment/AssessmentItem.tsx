"use client";

// One task of a test. There is no «Ответить» button: a choice is the answer
// the moment it is made, typed text is saved as you go and becomes the answer
// when you leave the field (or when the block is finished). Only learning
// mode with instant feedback keeps an explicit «Проверить» for items where
// checking a half-built answer would make no sense.

import { useEffect, useRef, useState } from "react";
import { Check, HelpCircle, Lightbulb, X } from "lucide-react";
import { ListeningPlayer } from "./ListeningPlayer";
import { SpeechRecorder } from "./SpeechRecorder";
import { TappableText } from "./WordTools";
import { isEmptyAnswer, type AnswerValue, type View, type ViewItem } from "./types";

type Props = {
  assessmentId: string;
  sectionId: string;
  item: ViewItem;
  index: number;
  mode: "learning" | "diagnostic";
  /** Learning mode with instant feedback: answers are checked, not just saved. */
  checkMode: boolean;
  language: string;
  disabled: boolean;
  onDraft: (itemId: string, value: AnswerValue) => void;
  onAnswer: (itemId: string, value: AnswerValue) => Promise<void>;
  onDontKnow: (itemId: string) => Promise<void>;
  onView: (view: View) => void;
};

const DRAFT_DELAY_MS = 700;
const COMMIT_DELAY_MS = 600;

const SPEAKING = new Set(["read_aloud", "repeat", "spoken_response"]);
const TYPED = new Set(["short_answer", "writing", "translation", "gap_text"]);

function initialValue(item: ViewItem): AnswerValue | null {
  return item.answer.draft ?? item.answer.value ?? null;
}

function complete(item: ViewItem, value: AnswerValue | null): boolean {
  if (value === null || isEmptyAnswer(value)) return false;
  if (item.type === "word_order") return Array.isArray(value) && value.length === (item.words?.length ?? 0);
  if (item.type === "gap_select" || item.type === "gap_text") {
    const given = typeof value === "object" && !Array.isArray(value) ? value : {};
    return (item.gaps ?? []).every((g) => String(given[g.id] ?? "").trim());
  }
  return true;
}

export function AssessmentItem(props: Props) {
  const { assessmentId, sectionId, item, index, mode, checkMode, language, disabled, onDraft, onAnswer, onDontKnow, onView } = props;
  const [value, setValue] = useState<AnswerValue | null>(() => initialValue(item));
  const [showHint, setShowHint] = useState(false);
  const [sending, setSending] = useState(false);
  const draftTimer = useRef<number | null>(null);
  const commitTimer = useRef<number | null>(null);
  const locked = item.locked || disabled;
  const speaking = SPEAKING.has(item.type);

  // A server-side change replaces the local value; the learner's own typing does not.
  const committedKey = JSON.stringify(item.answer.value) + item.answer.status;
  const [seenKey, setSeenKey] = useState(committedKey);
  if (seenKey !== committedKey) {
    setSeenKey(committedKey);
    if (item.answer.value !== null) setValue(item.answer.value);
  }

  useEffect(() => () => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
  }, []);

  const commit = async (next: AnswerValue | null) => {
    if (next === null || !complete(item, next)) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    if (JSON.stringify(next) === JSON.stringify(item.answer.value) && item.answer.status === "answered") return;
    setSending(true);
    try { await onAnswer(item.id, next); } finally { setSending(false); }
  };

  /** Explicit check is for learning mode on items where a half answer would be checked too early. */
  const needsCheckButton = checkMode && ["multiple_choice", "gap_select", "gap_text", "word_order", "short_answer", "translation"].includes(item.type);

  const change = (next: AnswerValue, how: "instant" | "soon" | "typed") => {
    setValue(next);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    if (commitTimer.current) window.clearTimeout(commitTimer.current);
    // Typed text, and an answer not yet complete (a gap still empty), are kept
    // as a draft; finishing the block turns the draft into the answer.
    if (needsCheckButton || how === "typed" || !complete(item, next)) {
      draftTimer.current = window.setTimeout(() => onDraft(item.id, next), DRAFT_DELAY_MS);
      return;
    }
    if (how === "instant") { void commit(next); return; }
    commitTimer.current = window.setTimeout(() => void commit(next), COMMIT_DELAY_MS);
  };

  /** Typed answers become answers when the field is left. */
  const leave = () => {
    if (!needsCheckButton && TYPED.has(item.type)) void commit(value);
  };

  const dontKnow = async () => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    setSending(true);
    try { await onDontKnow(item.id); } finally { setSending(false); }
  };

  const committed = item.answer.status !== null && (item.answer.value !== null || item.answer.status === "dont_know");
  const pendingChange = committed && item.answer.status === "answered" && JSON.stringify(value) !== JSON.stringify(item.answer.value);

  return (
    <article className={`asm-item${item.feedback ? ` is-${item.feedback.status}` : ""}`} id={`item-${item.id}`}>
      <header className="asm-item-head">
        <span className="asm-item-num">{index + 1}</span>
        {item.prompt && <p className="asm-item-prompt"><TappableText text={item.prompt} sectionId={sectionId} itemId={item.id} /></p>}
        <span className="asm-item-points">{item.points} б.</span>
      </header>

      {speaking ? (
        speakingTask()
      ) : (
        <ItemInput item={item} sectionId={sectionId} value={value} locked={locked} onChange={change} onLeave={leave} />
      )}

      {item.hint && !locked && (
        showHint
          ? <p className="asm-hint"><Lightbulb size={14} /> {item.hint}</p>
          : <button type="button" className="asm-link-btn" onClick={() => setShowHint(true)}><Lightbulb size={14} /> Подсказка</button>
      )}

      {!locked && (
        <div className="asm-item-actions">
          {needsCheckButton && (
            <button
              type="button"
              className="asm-btn asm-btn-primary"
              onClick={() => commit(value)}
              disabled={sending || !complete(item, value) || (committed && !pendingChange && item.answer.status === "answered")}
            >
              Проверить
            </button>
          )}
          <button type="button" className="asm-link-btn asm-dont-know" onClick={dontKnow} disabled={sending || item.answer.status === "dont_know"}>
            <HelpCircle size={14} /> Не знаю
          </button>
        </div>
      )}

      {!speaking && <ItemStatus item={item} mode={mode} committed={committed} pending={pendingChange} locked={locked} sending={sending} typed={TYPED.has(item.type)} />}
    </article>
  );

  // Plain JSX, not a nested component: a component declared in here would be
  // a new type on every render and remount the recorder, losing the take.
  function speakingTask() {
    return (
      <div className="asm-speaking">
        {item.type === "read_aloud" && item.text && (
          <p className="asm-read-text"><TappableText text={item.text} sectionId={sectionId} itemId={item.id} /></p>
        )}
        {item.type === "repeat" && item.sample && (
          <ListeningPlayer
            assessmentId={assessmentId}
            sectionId={item.sample.key}
            label="Образец — прослушайте и повторите"
            closed={locked}
            onView={onView}
            stimulus={{
              type: "audio", kind: "monologue", speakers: [], unlock_questions: "immediately", transcript: null,
              max_plays: item.sample.max_plays, used: item.sample.used, remaining: item.sample.remaining,
              audio_status: item.sample.audio_status, duration_ms: item.sample.duration_ms,
            }}
          />
        )}
        {item.type === "repeat" && item.text && <p className="asm-read-text">{item.text}</p>}
        <SpeechRecorder assessmentId={assessmentId} item={item} language={language} disabled={disabled} onView={onView} />
        {item.feedback && <Feedback item={item} />}
      </div>
    );
  }
}

function Feedback({ item }: { item: ViewItem }) {
  const f = item.feedback!;
  const label = {
    correct: "Верно",
    partial: "Частично верно",
    incorrect: "Неверно",
    dont_know: "Не знаю",
    unanswered: "Не выполнено",
    pending_review: "Ожидает проверки преподавателем",
    technical_issue: "Не оценено по техническим причинам",
  }[f.status];
  return (
    <div className={`asm-feedback is-${f.status}`}>
      <div className="asm-feedback-head">
        {f.status === "correct" ? <Check size={15} /> : f.status === "incorrect" ? <X size={15} /> : null}
        <strong>{label}</strong>
        {f.score !== null && <span>{f.score} из {f.max}</span>}
      </div>
      {f.status !== "correct" && f.expected && !f.speech && <p><span className="asm-muted">Правильно:</span> {f.expected}</p>}
      {f.notes.map((n) => <p key={n} className="asm-muted">{n}</p>)}
      {f.explanation && <p>{f.explanation}</p>}
      {f.corrected && <p><span className="asm-muted">Исправленный вариант:</span> {f.corrected}</p>}
      {f.teacher_comment && <p className="asm-teacher">{f.teacher_comment}</p>}
    </div>
  );
}

function ItemStatus({ item, mode, committed, pending, locked, sending, typed }: {
  item: ViewItem; mode: "learning" | "diagnostic"; committed: boolean; pending: boolean; locked: boolean; sending: boolean; typed: boolean;
}) {
  if (item.feedback) return <Feedback item={item} />;
  if (item.try_again) return <p className="asm-status is-wrong">Пока неверно — попробуйте ещё раз{item.answer.tries ? ` (попыток: ${item.answer.tries})` : ""}.</p>;
  if (sending) return <p className="asm-status">Сохраняем…</p>;
  if (locked) {
    if (!committed) return <p className="asm-status">Не выполнено.</p>;
    return <p className="asm-status">{item.answer.status === "dont_know" ? "Отмечено «не знаю»." : "Ответ принят."}</p>;
  }
  if (!committed) return null;
  if (pending) return <p className="asm-status">{typed ? "Сохранится, когда выйдете из поля." : "Сохраняем…"}</p>;
  if (item.answer.status === "dont_know") return <p className="asm-status">Отмечено «не знаю».</p>;
  return <p className="asm-status is-ok"><Check size={13} /> Сохранено{mode === "diagnostic" ? " — можно изменить до завершения блока" : ""}</p>;
}

// ─── Inputs by type ──────────────────────────────────────────────────────────

type InputProps = {
  item: ViewItem;
  sectionId: string;
  value: AnswerValue | null;
  locked: boolean;
  onChange: (v: AnswerValue, how: "instant" | "soon" | "typed") => void;
  onLeave: () => void;
};

function ItemInput({ item, sectionId, value, locked, onChange, onLeave }: InputProps) {
  switch (item.type) {
    case "single_choice":
      return (
        <div className="asm-options" role="radiogroup">
          {item.options?.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={value === o.id}
              className={`asm-option${value === o.id ? " is-selected" : ""}`}
              disabled={locked}
              onClick={() => onChange(o.id, "instant")}
            >
              <span className="asm-option-mark" />{o.text}
            </button>
          ))}
        </div>
      );
    case "multiple_choice": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div className="asm-options">
          <p className="asm-muted asm-small">Можно выбрать несколько.</p>
          {item.options?.map((o) => {
            const on = chosen.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                className={`asm-option is-multi${on ? " is-selected" : ""}`}
                disabled={locked}
                onClick={() => onChange(on ? chosen.filter((c) => c !== o.id) : [...chosen, o.id], "soon")}
              >
                <span className="asm-option-mark" />{o.text}
              </button>
            );
          })}
        </div>
      );
    }
    case "gap_select":
    case "gap_text":
      return <GapText item={item} sectionId={sectionId} value={value} locked={locked} onChange={onChange} onLeave={onLeave} />;
    case "word_order":
      return <WordOrder item={item} value={value} locked={locked} onChange={onChange} />;
    case "short_answer":
      return (
        <input
          className="asm-input"
          value={typeof value === "string" ? value : ""}
          disabled={locked}
          onChange={(e) => onChange(e.target.value, "typed")}
          onBlur={onLeave}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="Ваш ответ"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      );
    case "writing":
    case "translation": {
      const text = typeof value === "string" ? value : "";
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const range = [item.min_words ? `от ${item.min_words}` : "", item.max_words ? `до ${item.max_words}` : ""].filter(Boolean).join(" ");
      return (
        <div className="asm-writing">
          {item.type === "translation" && item.source && (
            <div className="asm-source">
              <span className="asm-muted asm-small">Переведите на немецкий:</span>
              <p>{item.source}</p>
            </div>
          )}
          <textarea
            className="asm-textarea"
            value={text}
            disabled={locked}
            onChange={(e) => onChange(e.target.value, "typed")}
            onBlur={onLeave}
            rows={item.type === "translation" ? 5 : 8}
            placeholder={item.type === "translation" ? "Ваш перевод" : "Напишите текст здесь"}
            spellCheck={false}
            autoCorrect="off"
            autoCapitalize="sentences"
          />
          <p className="asm-muted asm-small">Слов: {words}{range ? ` · нужно ${range}` : ""} · сохраняется автоматически</p>
        </div>
      );
    }
    default:
      return null;
  }
}

function GapText({ item, sectionId, value, locked, onChange, onLeave }: InputProps) {
  const given = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const parts = (item.text ?? "").split(/(\{\{\s*[A-Za-z0-9_.-]+\s*\}\})/g);
  return (
    <p className="asm-gap-text">
      {parts.map((part, i) => {
        const m = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/.exec(part);
        if (!m) return <TappableText key={i} text={part} sectionId={sectionId} itemId={item.id} />;
        const gap = item.gaps?.find((g) => g.id === m[1]);
        const current = given[m[1]] ?? "";
        if (gap?.options?.length) {
          return (
            <select
              key={i}
              className="asm-gap-select"
              value={current}
              disabled={locked}
              onChange={(e) => onChange({ ...given, [m[1]]: e.target.value }, "instant")}
              aria-label={`Пропуск ${m[1]}`}
            >
              <option value="">…</option>
              {gap.options.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          );
        }
        return (
          <input
            key={i}
            className="asm-gap-input"
            value={current}
            disabled={locked}
            onChange={(e) => onChange({ ...given, [m[1]]: e.target.value }, "typed")}
            onBlur={onLeave}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            style={{ width: `${Math.max(4, current.length + 2)}ch` }}
            aria-label={`Пропуск ${m[1]}`}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        );
      })}
    </p>
  );
}

/** Tap words in the pool to build the sentence; tap a placed word to send it back. */
function WordOrder({ item, value, locked, onChange }: Pick<InputProps, "item" | "value" | "locked" | "onChange">) {
  const words = item.words ?? [];
  // Positions in the pool, not texts: «die … die» are two separate tiles.
  const placed: number[] = [];
  const answer = Array.isArray(value) ? value : [];
  for (const w of answer) {
    const pos = words.findIndex((x, i) => x === w && !placed.includes(i));
    if (pos >= 0) placed.push(pos);
  }
  const set = (positions: number[]) => onChange(positions.map((p) => words[p]), "soon");
  return (
    <div className="asm-order">
      {item.meaning
        ? <p className="asm-order-meaning"><span className="asm-muted">Смысл:</span> {item.meaning}</p>
        : item.order_instruction && <p className="asm-muted asm-small">{item.order_instruction}</p>}
      <div className="asm-order-line" aria-label="Ваше предложение">
        {placed.length === 0 && <span className="asm-muted asm-small">Нажимайте на слова по порядку</span>}
        {placed.map((pos, i) => (
          <button key={`${pos}`} type="button" className="asm-chip is-placed" disabled={locked} onClick={() => set(placed.filter((_, j) => j !== i))}>
            {words[pos]}
          </button>
        ))}
      </div>
      <div className="asm-order-pool">
        {words.map((w, i) => (
          <button key={`${w}-${i}`} type="button" className="asm-chip" disabled={locked || placed.includes(i)} onClick={() => set([...placed, i])}>
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
