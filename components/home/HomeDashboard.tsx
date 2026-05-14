"use client";

import { BookOpen, ChevronRight, Library, SquareStack, TrendingUp } from "lucide-react";
import type { Book, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  book: Book | null;
  profile: UserProfile;
  cards: Flashcard[];
  onContinueReading: () => void;
  onOpenCards: () => void;
  onOpenBooks: () => void;
};

const LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  de: "Deutsch",
  en: "English",
  fr: "Français",
  es: "Español",
};

function langName(code: string) {
  return LANG_NAMES[code] ?? code.toUpperCase();
}

export function HomeDashboard({ book, profile, cards, onContinueReading, onOpenCards, onOpenBooks }: Props) {
  const totalCards = cards.length;
  const wordCards = cards.filter((c) => c.type === "word").length;
  const phraseCards = cards.filter((c) => c.type === "phrase").length;

  return (
    <section className="screen">
      {/* Header */}
      <header className="screen-header">
        <div>
          <p className="eyebrow">AIBook</p>
          <h1>Учебный день</h1>
        </div>
        <button className="icon-btn" onClick={onOpenBooks} type="button" aria-label="Библиотека">
          <Library size={20} />
        </button>
      </header>

      {/* Continue Reading */}
      {book ? (
        <button
          className="action-card reading"
          onClick={onContinueReading}
          type="button"
          style={{ width: "100%", marginBottom: 12 }}
        >
          <span className="action-card-icon"><BookOpen size={24} /></span>
          <span>
            <span className="action-card-label">Продолжить чтение</span>
            <strong className="action-card-title">{book.title}</strong>
            <span className="action-card-sub">{book.author} · {Math.round(book.progress)}%</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      ) : (
        <button
          className="action-card reading"
          onClick={onOpenBooks}
          type="button"
          style={{ width: "100%", marginBottom: 12 }}
        >
          <span className="action-card-icon"><BookOpen size={24} /></span>
          <span>
            <span className="action-card-label">Начать читать</span>
            <strong className="action-card-title">Загрузите первую книгу</strong>
            <span className="action-card-sub">TXT или EPUB</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      )}

      {/* Stats Grid */}
      <div className="stats-grid">
        <div className="stat-tile">
          <span className="stat-tile-value">{totalCards}</span>
          <span className="stat-tile-label">Карточек</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-value">{wordCards}</span>
          <span className="stat-tile-label">Слов</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-value">{phraseCards}</span>
          <span className="stat-tile-label">Фраз</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-value">{profile.readingMinutes}</span>
          <span className="stat-tile-label">Минут</span>
        </div>
      </div>

      {/* Cards CTA */}
      <button
        className="action-card study"
        onClick={onOpenCards}
        type="button"
        style={{ width: "100%", marginBottom: 16 }}
      >
        <span className="action-card-icon"><SquareStack size={24} /></span>
        <span>
          <span className="action-card-label" style={{ color: "var(--green)" }}>Карточки</span>
          <strong className="action-card-title">
            {totalCards > 0 ? `${totalCards} сохранённых` : "Пока пусто"}
          </strong>
          <span className="action-card-sub">Слова и фразы из книг</span>
        </span>
        <ChevronRight size={20} className="action-card-arrow" style={{ color: "var(--green)" }} />
      </button>

      {/* AI Profile strip */}
      <div className="surface-card" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        <TrendingUp size={18} style={{ color: "var(--accent)", flexShrink: 0 }} />
        <div style={{ fontSize: 13 }}>
          <span style={{ color: "var(--text-muted)" }}>Родной:</span>{" "}
          <strong>{langName(profile.nativeLanguage)}</strong>
          {"  ·  "}
          <span style={{ color: "var(--text-muted)" }}>Изучаю:</span>{" "}
          <strong>{langName(profile.targetLanguage)}</strong>
        </div>
      </div>
    </section>
  );
}
