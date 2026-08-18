"use client";

import { BookOpen, GraduationCap, Loader2, Wand2, X } from "lucide-react";
import type { CefrLevel } from "@/lib/types";
import { DictateButton, appendSpoken } from "./DictateButton";

export type LessonLength = "short" | "medium" | "long";
export type LessonKind = "text" | "lesson";

export type ComposerState = {
  /**
   * A text to read, or a lesson to work through. Asked first, because it is
   * not a setting on one document — it decides which of two documents is
   * being made, and the rest of the form reads differently for each.
   */
  kind: LessonKind;
  topic: string;
  context: string;
  level: CefrLevel;
  length: LessonLength;
  useReviewWords: boolean;
  /**
   * The pack this was started from, when it was started from one: its title,
   * the brief it was collected to, and its words. The generator gets all
   * three — a pack of accusative masculine nouns is a specification for the
   * language of the text, not just a bag of words to sprinkle through it.
   */
  packTitle?: string;
  packBrief?: string;
  packWords?: string[];
};

type Props = {
  value: ComposerState;
  onChange: (patch: Partial<ComposerState>) => void;
  /** Which step is on screen: choosing what to make, or filling it in. */
  step: "kind" | "form";
  onPickKind: (kind: LessonKind) => void;
  /** Words the SRS says are due now; drives the checkbox and the chip row. */
  dueReviewWords: string[];
  nativeLanguage: string;
  isGenerating: boolean;
  error: string | null;
  onSubmit: () => void;
  onClose: () => void;
};

const LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

const TEXT_LENGTHS: [LessonLength, string][] = [
  ["short", "Короткий · 4–5 абзацев"],
  ["medium", "Средний · 6–8 абзацев"],
  ["long", "Длинный · 10–12 абзацев"],
];

const LESSON_LENGTHS: [LessonLength, string][] = [
  ["short", "Короткий · один проход"],
  ["medium", "Средний · полное занятие"],
  ["long", "Большой · с исключениями"],
];

/**
 * Bottom-sheet form for a new text or lesson.
 *
 * Two steps, and the first one is not a formality: «текст» and «урок» produce
 * different documents. A text is prose to read with a few questions at the
 * end; a lesson explains one point, shows it, and gives exercises with answers.
 * Asking after the fact — as a checkbox on one form — is what produced texts
 * with a word list stapled on and nothing to do.
 *
 * Form styling (.lesson-field, .lesson-input-row, .dictate-btn) comes from the
 * style block in DiscoverView, which always renders alongside this modal.
 */
export function LessonComposerModal({
  value, onChange, step, onPickKind, dueReviewWords, nativeLanguage, isGenerating, error, onSubmit, onClose,
}: Props) {
  const isLesson = value.kind === "lesson";
  const canSubmit = value.topic.trim().length > 0 && !isGenerating;
  const fromPack = Boolean(value.packTitle);
  const packWords = value.packWords ?? [];

  return (
    <div className="book-modal-backdrop" onClick={onClose}>
      <div className="book-modal" onClick={(e) => e.stopPropagation()}>
        <div className="book-modal-header">
          <strong>
            {step === "kind"
              ? fromPack ? `Из пачки «${value.packTitle}»` : "Что создаём?"
              : isLesson ? "Новый урок" : "Новый текст"}
          </strong>
          <button onClick={onClose} className="icon-btn modal-close" type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
        </div>

        <div className="book-modal-content">
          {step === "kind" ? (
            <div className="lesson-kind-picker">
              <button type="button" className="lesson-kind-card" onClick={() => onPickKind("text")}>
                <BookOpen size={22} />
                <strong>Текст</strong>
                <span>Просто читать. Без словаря под текстом — в конце несколько контрольных вопросов.</span>
              </button>
              <button type="button" className="lesson-kind-card" onClick={() => onPickKind("lesson")}>
                <GraduationCap size={22} />
                <strong>Урок</strong>
                <span>Разбор одной темы: объяснение, примеры, живой текст, аудирование и упражнения с ответами.</span>
              </button>
            </div>
          ) : (
            <div className="lesson-form">
              {fromPack && (
                <div className="lesson-pack-note">
                  <strong>Материал: пачка «{value.packTitle}»</strong>
                  {value.packBrief && <span>{value.packBrief}</span>}
                  <span>{packWords.length} слов и фраз пойдут в {isLesson ? "урок" : "текст"}.</span>
                </div>
              )}

              <label className="lesson-field">
                <span>{isLesson ? "Тема урока" : "Тема"}</span>
                <div className="lesson-input-row">
                  <input
                    type="text"
                    autoFocus
                    placeholder={isLesson ? "Например: Akkusativ с прилагательными" : "Например: Wohnungssuche in Berlin"}
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
                {isLesson && <small>Одна тема на урок — то, чему он должен научить.</small>}
              </label>

              <label className="lesson-field">
                <span>{isLesson ? "Пожелания к уроку" : "Детали"} <em>необязательно</em></span>
                <div className="lesson-input-row">
                  <textarea
                    rows={3}
                    placeholder={isLesson
                      ? "Например: побольше упражнений на перевод с русского; я путаю der/den"
                      : "Например: друг держит цветочный магазин, живём вместе"}
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
                <small>
                  {isLesson
                    ? "Это важнее всего остального: урок строится вокруг того, что вы здесь напишете."
                    : "Факты отсюда важнее слов на повторении: слово, которое им противоречит, будет пропущено."}
                </small>
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
                    {(isLesson ? LESSON_LENGTHS : TEXT_LENGTHS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {/* A pack brings its own words; the deck's due words are what a
                  text written from nothing draws on. Offering both at once
                  would be two answers to one question. */}
              {!fromPack && (
                <>
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
                </>
              )}

              {fromPack && packWords.length > 0 && (
                <div className="lesson-words">
                  {packWords.slice(0, 24).map((w) => <span key={w}>{w}</span>)}
                  {packWords.length > 24 && <span>и ещё {packWords.length - 24}</span>}
                </div>
              )}

              <button type="button" className="seed-btn" onClick={onSubmit} disabled={!canSubmit}>
                {isGenerating
                  ? <><Loader2 className="spin" size={15} />{isLesson ? "Составляю урок..." : "Пишу текст..."}</>
                  : <><Wand2 size={15} />{isLesson ? "Составить урок" : "Написать текст"}</>}
              </button>

              {error && <div className="inline-error">{error}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
