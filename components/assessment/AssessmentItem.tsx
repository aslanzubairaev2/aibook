"use client";

// One task of a test: its input, «Ответить» / «Не знаю», and — once the
// server releases it — the feedback. The value being typed is autosaved as a
// draft, so closing the app mid-sentence loses nothing; only «Ответить»
// turns it into an answer.

import { useEffect, useRef, useState } from "react";
import { Check, HelpCircle, Lightbulb, X } from "lucide-react";
import { isEmptyAnswer, type AnswerValue, type ViewItem } from "./types";

type Props = {
  item: ViewItem;
  index: number;
  mode: "learning" | "diagnostic";
  disabled: boolean;
  onDraft: (itemId: string, value: AnswerValue) => void;
  onAnswer: (itemId: string, value: AnswerValue) => Promise<void>;
  onDontKnow: (itemId: string) => Promise<void>;
};

const DRAFT_DELAY_MS = 800;

function initialValue(item: ViewItem): AnswerValue | null {
  return item.answer.draft ?? item.answer.value ?? null;
}

export function AssessmentItem({ item, index, mode, disabled, onDraft, onAnswer, onDontKnow }: Props) {
  const [value, setValue] = useState<AnswerValue | null>(() => initialValue(item));
  const [showHint, setShowHint] = useState(false);
  const [sending, setSending] = useState(false);
  const draftTimer = useRef<number | null>(null);
  const locked = item.locked || disabled;

  // A different attempt or a server-side change replaces the local value; the
  // learner's own typing (same item, same committed answer) does not.
  const committedKey = JSON.stringify(item.answer.value) + item.answer.status;
  const [seenKey, setSeenKey] = useState(committedKey);
  if (seenKey !== committedKey) {
    setSeenKey(committedKey);
    if (item.answer.value !== null) setValue(item.answer.value);
  }

  useEffect(() => () => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
  }, []);

  const change = (next: AnswerValue) => {
    setValue(next);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => onDraft(item.id, next), DRAFT_DELAY_MS);
  };

  const submit = async () => {
    if (value === null || isEmptyAnswer(value)) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    setSending(true);
    try { await onAnswer(item.id, value); } finally { setSending(false); }
  };

  const dontKnow = async () => {
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    setSending(true);
    try { await onDontKnow(item.id); } finally { setSending(false); }
  };

  const committed = item.answer.status !== null && (item.answer.value !== null || item.answer.status === "dont_know");
  const changedSinceAnswer = committed && JSON.stringify(value) !== JSON.stringify(item.answer.value);

  return (
    <article className={`asm-item${item.feedback ? ` is-${item.feedback.status}` : ""}`} id={`item-${item.id}`}>
      <header className="asm-item-head">
        <span className="asm-item-num">{index + 1}</span>
        {item.prompt && <p className="asm-item-prompt">{item.prompt}</p>}
        <span className="asm-item-points">{item.points} б.</span>
      </header>

      <ItemInput item={item} value={value} locked={locked} onChange={change} />

      {item.hint && !locked && (
        showHint
          ? <p className="asm-hint"><Lightbulb size={14} /> {item.hint}</p>
          : <button type="button" className="asm-link-btn" onClick={() => setShowHint(true)}><Lightbulb size={14} /> Подсказка</button>
      )}

      {!locked && (
        <div className="asm-item-actions">
          <button
            type="button"
            className="asm-btn asm-btn-primary"
            onClick={submit}
            disabled={sending || value === null || isEmptyAnswer(value) || (committed && !changedSinceAnswer && item.answer.status === "answered")}
          >
            {committed && item.answer.status === "answered" && !changedSinceAnswer ? "Ответ принят" : "Ответить"}
          </button>
          <button type="button" className="asm-btn" onClick={dontKnow} disabled={sending || item.answer.status === "dont_know" && !changedSinceAnswer}>
            <HelpCircle size={15} /> Не знаю
          </button>
        </div>
      )}

      <ItemStatus item={item} mode={mode} committed={committed} changed={changedSinceAnswer} locked={locked} />
    </article>
  );
}

function ItemStatus({ item, mode, committed, changed, locked }: { item: ViewItem; mode: "learning" | "diagnostic"; committed: boolean; changed: boolean; locked: boolean }) {
  const f = item.feedback;
  if (f) {
    const label = {
      correct: "Верно",
      partial: "Частично верно",
      incorrect: "Неверно",
      dont_know: "Не знаю",
      unanswered: "Без ответа",
      pending_review: "Ожидает проверки преподавателем",
    }[f.status];
    return (
      <div className={`asm-feedback is-${f.status}`}>
        <div className="asm-feedback-head">
          {f.status === "correct" ? <Check size={15} /> : f.status === "incorrect" ? <X size={15} /> : null}
          <strong>{label}</strong>
          {f.score !== null && <span>{f.score} из {f.max}</span>}
        </div>
        {f.status !== "correct" && f.expected && <p><span className="asm-muted">Правильно:</span> {f.expected}</p>}
        {f.notes.map((n) => <p key={n} className="asm-muted">{n}</p>)}
        {f.explanation && <p>{f.explanation}</p>}
        {f.corrected && <p><span className="asm-muted">Исправленный вариант:</span> {f.corrected}</p>}
        {f.teacher_comment && <p className="asm-teacher">{f.teacher_comment}</p>}
      </div>
    );
  }
  if (item.try_again) return <p className="asm-status is-wrong">Пока неверно — попробуйте ещё раз{item.answer.tries ? ` (попыток: ${item.answer.tries})` : ""}.</p>;
  if (!committed) return locked ? <p className="asm-status">Без ответа.</p> : null;
  if (locked) return <p className="asm-status">{item.answer.status === "dont_know" ? "Отмечено «не знаю»." : "Ответ принят."}</p>;
  if (changed) return <p className="asm-status">Изменено — нажмите «Ответить», чтобы сохранить новый ответ.</p>;
  if (item.answer.status === "dont_know") return <p className="asm-status">Отмечено «не знаю».</p>;
  return (
    <p className="asm-status is-ok">
      {mode === "diagnostic" ? "Ответ сохранён. Его можно изменить до завершения блока." : "Ответ сохранён."}
    </p>
  );
}

// ─── Inputs by type ──────────────────────────────────────────────────────────

function ItemInput({ item, value, locked, onChange }: { item: ViewItem; value: AnswerValue | null; locked: boolean; onChange: (v: AnswerValue) => void }) {
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
              onClick={() => onChange(o.id)}
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
                onClick={() => onChange(on ? chosen.filter((c) => c !== o.id) : [...chosen, o.id])}
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
      return <GapText item={item} value={value} locked={locked} onChange={onChange} />;
    case "word_order":
      return <WordOrder item={item} value={value} locked={locked} onChange={onChange} />;
    case "short_answer":
      return (
        <input
          className="asm-input"
          value={typeof value === "string" ? value : ""}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ваш ответ"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
        />
      );
    case "writing": {
      const text = typeof value === "string" ? value : "";
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      const range = [item.min_words ? `от ${item.min_words}` : "", item.max_words ? `до ${item.max_words}` : ""].filter(Boolean).join(" ");
      return (
        <div className="asm-writing">
          <textarea
            className="asm-textarea"
            value={text}
            disabled={locked}
            onChange={(e) => onChange(e.target.value)}
            rows={8}
            placeholder="Напишите текст здесь"
            spellCheck={false}
            autoCorrect="off"
          />
          <p className="asm-muted asm-small">Слов: {words}{range ? ` · нужно ${range}` : ""}</p>
        </div>
      );
    }
  }
}

function GapText({ item, value, locked, onChange }: { item: ViewItem; value: AnswerValue | null; locked: boolean; onChange: (v: AnswerValue) => void }) {
  const given = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const parts = (item.text ?? "").split(/(\{\{\s*[A-Za-z0-9_.-]+\s*\}\})/g);
  return (
    <p className="asm-gap-text">
      {parts.map((part, i) => {
        const m = /^\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}$/.exec(part);
        if (!m) return <span key={i}>{part}</span>;
        const gap = item.gaps?.find((g) => g.id === m[1]);
        const current = given[m[1]] ?? "";
        const set = (v: string) => onChange({ ...given, [m[1]]: v });
        if (gap?.options?.length) {
          return (
            <select key={i} className="asm-gap-select" value={current} disabled={locked} onChange={(e) => set(e.target.value)} aria-label={`Пропуск ${m[1]}`}>
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
            onChange={(e) => set(e.target.value)}
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
function WordOrder({ item, value, locked, onChange }: { item: ViewItem; value: AnswerValue | null; locked: boolean; onChange: (v: AnswerValue) => void }) {
  const words = item.words ?? [];
  const placed = Array.isArray(value) ? value : [];
  // Words can repeat («die … die»), so the pool is tracked by position, not text.
  const usedPositions = new Set<number>();
  for (const w of placed) {
    const pos = words.findIndex((x, i) => x === w && !usedPositions.has(i));
    if (pos >= 0) usedPositions.add(pos);
  }
  return (
    <div className="asm-order">
      <div className="asm-order-line" aria-label="Ваше предложение">
        {placed.length === 0 && <span className="asm-muted asm-small">Нажимайте на слова по порядку</span>}
        {placed.map((w, i) => (
          <button key={`${w}-${i}`} type="button" className="asm-chip is-placed" disabled={locked} onClick={() => onChange(placed.filter((_, j) => j !== i))}>
            {w}
          </button>
        ))}
      </div>
      <div className="asm-order-pool">
        {words.map((w, i) => (
          <button key={`${w}-${i}`} type="button" className="asm-chip" disabled={locked || usedPositions.has(i)} onClick={() => onChange([...placed, w])}>
            {w}
          </button>
        ))}
      </div>
    </div>
  );
}
