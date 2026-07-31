"use client";

import { Loader2, Wand2, X } from "lucide-react";
import type { CefrLevel } from "@/lib/types";
import { DictateButton, appendSpoken } from "./DictateButton";

export type LessonLength = "short" | "medium" | "long";

export type ComposerState = {
  topic: string;
  context: string;
  level: CefrLevel;
  length: LessonLength;
  useReviewWords: boolean;
};

type Props = {
  value: ComposerState;
  onChange: (patch: Partial<ComposerState>) => void;
  /** Words the SRS says are due now; drives the checkbox and the chip row. */
  dueReviewWords: string[];
  nativeLanguage: string;
  isGenerating: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
};

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

/**
 * Bottom-sheet form for a new generated lesson.
 *
 * Lives in a modal rather than on the tab: it is a once-in-a-while action, and
 * inline it pushed the actual lesson list off the first screen.
 *
 * Form styling (.lesson-field, .lesson-input-row, .dictate-btn) comes from the
 * style block in DiscoverView, which always renders alongside this modal.
 */
export function LessonComposerModal({
  value, onChange, dueReviewWords, nativeLanguage, isGenerating, error, onSubmit, onClose,
}: Props) {
  const canSubmit = value.topic.trim().length > 0 && !isGenerating;

  return (
    <div className="book-modal-backdrop" onClick={onClose}>
      <div className="book-modal" onClick={(e) => e.stopPropagation()}>
        <div className="book-modal-header">
          <strong>Новый урок</strong>
          <button onClick={onClose} className="icon-btn modal-close" type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="book-modal-content">
          <div className="lesson-form">
            <label className="lesson-field">
              <span>Тема</span>
              <div className="lesson-input-row">
                <input
                  type="text"
                  autoFocus
                  placeholder="Например: Wohnungssuche in Berlin"
                  value={value.topic}
                  onChange={(e) => onChange({ topic: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) onSubmit(); }}
                  maxLength={200}
                />
                <DictateButton
                  lang={nativeLanguage}
                  title="Наговорить тему"
                  onText={(t) => onChange({ topic: appendSpoken(value.topic, t) })}
                />
              </div>
            </label>

            <label className="lesson-field">
              <span>Детали <em>необязательно</em></span>
              <div className="lesson-input-row">
                <textarea
                  rows={3}
                  placeholder="Например: друг держит цветочный магазин, живём вместе"
                  value={value.context}
                  onChange={(e) => onChange({ context: e.target.value })}
                  maxLength={1000}
                />
                <DictateButton
                  lang={nativeLanguage}
                  title="Наговорить детали"
                  onText={(t) => onChange({ context: appendSpoken(value.context, t) })}
                />
              </div>
              <small>Факты отсюда важнее слов на повторении: слово, которое им противоречит, будет пропущено.</small>
            </label>

            <div className="lesson-row">
              <label className="lesson-field">
                <span>Уровень</span>
                <select value={value.level} onChange={(e) => onChange({ level: e.target.value as CefrLevel })}>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
              <label className="lesson-field">
                <span>Объём</span>
                <select value={value.length} onChange={(e) => onChange({ length: e.target.value as LessonLength })}>
                  <option value="short">Короткий</option>
                  <option value="medium">Средний</option>
                  <option value="long">Длинный</option>
                </select>
              </label>
            </div>

            <label className="lesson-check">
              <input
                type="checkbox"
                // With nothing due, a checked-but-disabled box would read as
                // "words will be used" when none can be.
                checked={value.useReviewWords && dueReviewWords.length > 0}
                onChange={(e) => onChange({ useReviewWords: e.target.checked })}
                disabled={dueReviewWords.length === 0}
              />
              <span>
                {dueReviewWords.length > 0
                  ? `Использовать ${dueReviewWords.length} слов(а) из карточек, готовых к повторению`
                  : "Нет карточек, готовых к повторению"}
              </span>
            </label>

            {value.useReviewWords && dueReviewWords.length > 0 && (
              <div className="lesson-words">
                {dueReviewWords.map((w) => <span key={w}>{w}</span>)}
              </div>
            )}

            <button type="button" className="seed-btn" onClick={onSubmit} disabled={!canSubmit}>
              {isGenerating
                ? <><Loader2 className="spin" size={15} />Генерирую урок...</>
                : <><Wand2 size={15} />Сгенерировать урок</>}
            </button>

            {error && <div className="inline-error">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
