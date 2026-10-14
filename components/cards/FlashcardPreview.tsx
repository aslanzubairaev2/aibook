"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, X } from "lucide-react";
import type { Flashcard } from "@/lib/types";
import { FLASHCARD_PREVIEW_EVENT } from "@/lib/wordMenu";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { CardBackSummary } from "@/components/cards/CardBackSummary";

const STATUS_LABELS: Record<string, string> = {
  new: "Новая",
  learning: "Изучается",
  review: "Повторение",
  relearning: "Переучивание",
};

function dueLabel(dueAt: string): string {
  const due = Date.parse(dueAt);
  if (!Number.isFinite(due)) return "";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.floor((due - startOfToday.getTime()) / 86_400_000);
  if (days <= 0) return "повтор сегодня";
  if (days === 1) return "повтор завтра";
  const date = new Date(due);
  const sameYear = date.getFullYear() === startOfToday.getFullYear();
  return `повтор ${date.toLocaleDateString("ru-RU", sameYear ? { day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" })}`;
}

/**
 * A card shown as the trainer shows it — front, tap to flip — but read-only:
 * there are no grade buttons, so looking at a card from the dictionary, a pack
 * or the right-click menu can never move its schedule.
 *
 * Mounted once for the whole app and opened with openFlashcardPreview(id).
 */
export function FlashcardPreview({ cards, targetLanguage }: { cards: Flashcard[]; targetLanguage: string }) {
  const [cardId, setCardId] = useState<string | null>(null);
  const [flipped, setFlipped] = useState(false);

  useEffect(() => {
    const open = (e: Event) => {
      setCardId((e as CustomEvent<string>).detail);
      setFlipped(false);
    };
    window.addEventListener(FLASHCARD_PREVIEW_EVENT, open);
    return () => window.removeEventListener(FLASHCARD_PREVIEW_EVENT, open);
  }, []);

  useEffect(() => {
    if (!cardId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCardId(null);
      else if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped((f) => !f); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cardId]);

  const card = cardId ? cards.find((c) => c.id === cardId) : undefined;
  if (!card || typeof document === "undefined") return null;

  const meta = [STATUS_LABELS[card.status] ?? card.status, dueLabel(card.dueAt)].filter(Boolean).join(" · ");

  return createPortal(
    <div className="modal-backdrop fc-preview-backdrop" onClick={() => setCardId(null)}>
      <div className="fc-preview" role="dialog" aria-modal aria-label={`Флешкарта «${card.front}»`} onClick={(e) => e.stopPropagation()}>
        <div className="fc-preview-top">
          <span className="fc-preview-badge"><Eye size={13} /> Просмотр</span>
          <span className="fc-preview-meta">{meta}</span>
          <button type="button" className="icon-btn fc-preview-close" aria-label="Закрыть" onClick={() => setCardId(null)}>
            <X size={18} />
          </button>
        </div>

        <button
          type="button"
          className={`fc-preview-card${flipped ? " flipped" : ""}`}
          onClick={() => setFlipped((f) => !f)}
          aria-label={flipped ? "Показать лицевую сторону" : "Показать обратную сторону"}
        >
          <span className="fc-preview-face fc-preview-front">
            <span className="fc-preview-front-text">{card.front}</span>
          </span>
          <span className="fc-preview-face fc-preview-back">
            <span className="fc-preview-back-word">{card.front}</span>
            <CardBackSummary front={card.front} back={card.back} />
          </span>
        </button>

        <div className="fc-preview-foot">
          <span className="fc-preview-source">{card.sourceBookTitle || card.source}</span>
          <span onClick={(e) => e.stopPropagation()}>
            <SpeakButton text={card.front} lang={targetLanguage} size={18} />
          </span>
        </div>
        <p className="fc-preview-hint">Нажмите на карточку, чтобы перевернуть. Здесь только просмотр — прогресс не меняется.</p>
      </div>
    </div>,
    document.body,
  );
}
