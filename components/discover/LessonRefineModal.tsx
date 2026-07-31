"use client";

import { Loader2, Pencil, X } from "lucide-react";
import { DictateButton, appendSpoken } from "./DictateButton";

type Props = {
  /** Title of the lesson being revised, so the sheet says what it is editing. */
  lessonTitle: string;
  value: string;
  onChange: (text: string) => void;
  nativeLanguage: string;
  isRefining: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
};

/**
 * Bottom-sheet for revising an existing generated lesson from free-text notes.
 *
 * Form styling comes from the style block in DiscoverView, which always
 * renders alongside this modal.
 */
export function LessonRefineModal({
  lessonTitle, value, onChange, nativeLanguage, isRefining, error, onSubmit, onClose,
}: Props) {
  const canSubmit = value.trim().length > 0 && !isRefining;

  return (
    <div className="book-modal-backdrop" onClick={onClose}>
      <div className="book-modal" onClick={(e) => e.stopPropagation()}>
        <div className="book-modal-header">
          <strong>Изменить текст</strong>
          <button onClick={onClose} className="icon-btn modal-close" type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="book-modal-content">
          <div className="lesson-form">
            <p className="refine-target">{lessonTitle}</p>

            <label className="lesson-field">
              <span>Что изменить</span>
              <div className="lesson-input-row">
                <textarea
                  rows={4}
                  autoFocus
                  placeholder="Например: друг работает не в магазине, а в цветочной лавке; мы живём вместе, а не по отдельности"
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
              <small>Остальной текст останется как есть — меняется только то, о чём вы просите, и то, что из этого следует.</small>
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
