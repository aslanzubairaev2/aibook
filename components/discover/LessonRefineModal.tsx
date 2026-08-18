"use client";

import { Loader2, Pencil, X } from "lucide-react";
import { DictateButton, appendSpoken } from "./DictateButton";
import type { LessonLength } from "./LessonComposerModal";

type Props = {
  /** Title of the document being revised, so the sheet says what it is editing. */
  lessonTitle: string;
  /** A text to read, or a lesson to work through — the wording follows. */
  kind: "text" | "lesson";
  value: string;
  onChange: (text: string) => void;
  /** A new size, or null to leave it as it is. */
  length: LessonLength | null;
  onLengthChange: (length: LessonLength | null) => void;
  nativeLanguage: string;
  isRefining: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
};

const LENGTHS: [LessonLength, string][] = [
  ["short", "Короче"],
  ["medium", "Средний"],
  ["long", "Длиннее"],
];

/**
 * Bottom-sheet for revising an existing text or lesson.
 *
 * Two ways to ask, because they are asked differently. A note is prose — «друг
 * работает не в магазине, а в лавке» — and only the learner can write it.
 * Resizing is the same request every time, and typing «сделай покороче» into a
 * free-text box is both slower and vaguer than pressing the word, so it is a
 * control; either one may be sent on its own.
 *
 * Form styling comes from the style block in DiscoverView, which always
 * renders alongside this modal.
 */
export function LessonRefineModal({
  lessonTitle, kind, value, onChange, length, onLengthChange, nativeLanguage, isRefining, error, onSubmit, onClose,
}: Props) {
  const canSubmit = (value.trim().length > 0 || length !== null) && !isRefining;
  const noun = kind === "lesson" ? "урок" : "текст";

  return (
    <div className="book-modal-backdrop" onClick={onClose}>
      <div className="book-modal" onClick={(e) => e.stopPropagation()}>
        <div className="book-modal-header">
          <strong>{kind === "lesson" ? "Изменить урок" : "Изменить текст"}</strong>
          <button onClick={onClose} className="icon-btn modal-close" type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="book-modal-content">
          <div className="lesson-form">
            <p className="refine-target">{lessonTitle}</p>

            <div className="lesson-field">
              <span>Объём</span>
              <div className="filter-chips">
                <button
                  type="button"
                  className={`filter-chip ${length === null ? "active" : ""}`}
                  onClick={() => onLengthChange(null)}
                >
                  Как есть
                </button>
                {LENGTHS.map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    className={`filter-chip ${length === val ? "active" : ""}`}
                    onClick={() => onLengthChange(length === val ? null : val)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <label className="lesson-field">
              <span>Что изменить <em>необязательно</em></span>
              <div className="lesson-input-row">
                <textarea
                  rows={4}
                  autoFocus
                  placeholder={kind === "lesson"
                    ? "Например: больше упражнений на перевод; объясни подробнее разницу der/den"
                    : "Например: друг работает не в магазине, а в цветочной лавке; мы живём вместе, а не по отдельности"}
                  value={value}
                  onChange={(e) => onChange(e.target.value)}
                  maxLength={2000}
                />
                <DictateButton
                  lang={nativeLanguage}
                  title="Наговорить правки"
                  onText={(t) => onChange(appendSpoken(value, t))}
                />
              </div>
              <small>Остальной {noun} останется как есть — меняется только то, о чём вы просите, и то, что из этого следует.</small>
            </label>

            <button type="button" className="seed-btn" onClick={onSubmit} disabled={!canSubmit}>
              {isRefining
                ? <><Loader2 className="spin" size={15} />Переписываю...</>
                : <><Pencil size={15} />Применить</>}
            </button>

            {error && <div className="inline-error">{error}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
