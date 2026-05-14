"use client";

import { BookOpen, ChevronRight, Flame, Library, SquareStack } from "lucide-react";
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
  ru: "Русский", de: "Deutsch", en: "English", fr: "Français", es: "Español",
};

export function HomeDashboard({ book, profile, cards, onContinueReading, onOpenCards, onOpenBooks }: Props) {
  const totalCards = cards.length;
  const wordCards = cards.filter((c) => c.type === "word").length;
  const phraseCards = cards.filter((c) => c.type === "phrase").length;

  return (
    <section className="screen">
      {/* Header */}
      <header className="home-header">
        <div>
          <h1 className="home-title">Твой учебный день</h1>
        </div>
        <div className="home-header-right">
          <Flame size={18} style={{ color: "var(--accent)" }} />
          <span className="home-streak">{totalCards}</span>
          <button className="icon-btn" onClick={onOpenBooks} type="button" aria-label="Библиотека">
            <Library size={19} />
          </button>
        </div>
      </header>

      {/* Current book hero card */}
      {book ? (
        <div className="book-hero-card">
          <div className="book-hero-cover" style={{ background: book.coverColor }}>
            <span className="book-hero-lang">{book.language.toUpperCase()}</span>
          </div>
          <div className="book-hero-info">
            <p className="book-hero-eyebrow">ПРОДОЛЖИТЬ ЧТЕНИЕ</p>
            <strong className="book-hero-title">{book.title}</strong>
            <span className="book-hero-author">{book.author}</span>
            <div className="book-hero-progress">
              <div className="progress-bar" style={{ marginTop: 8 }}>
                <div className="progress-bar-fill" style={{ width: `${book.progress}%` }} />
              </div>
              <span style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                {book.chapterTitle} · {Math.round(book.progress)}%
              </span>
            </div>
          </div>
          <button className="book-hero-cta primary-btn" type="button" onClick={onContinueReading}>
            <BookOpen size={17} />
            Продолжить чтение
          </button>
        </div>
      ) : (
        <button
          className="action-card reading"
          onClick={onOpenBooks}
          type="button"
          style={{ width: "100%", marginBottom: 16 }}
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

      {/* Vocabulary progress */}
      <div className="vocab-section">
        <div className="vocab-header">
          <span className="vocab-title">Словарный прогресс</span>
          <span className="vocab-today">На сегодня</span>
        </div>
        <div className="vocab-grid">
          <div className="vocab-ring-wrap">
            <svg viewBox="0 0 80 80" className="vocab-ring" aria-hidden>
              <circle cx="40" cy="40" r="32" fill="none" strokeWidth="6" stroke="rgba(240,230,211,0.08)" />
              <circle
                cx="40" cy="40" r="32" fill="none" strokeWidth="6"
                stroke="var(--accent)" strokeLinecap="round"
                strokeDasharray={`${Math.min(totalCards / 2, 200.96)}, 200.96`}
                transform="rotate(-90 40 40)"
              />
            </svg>
            <div className="vocab-ring-label">
              <span className="vocab-ring-count">{totalCards}</span>
              <span className="vocab-ring-sub">карточек</span>
            </div>
          </div>
          <div className="vocab-stats">
            <div className="vocab-stat">
              <span className="vocab-dot" style={{ background: "var(--green)" }} />
              <span className="vocab-stat-label">Слова</span>
              <span className="vocab-stat-val">{wordCards}</span>
            </div>
            <div className="vocab-stat">
              <span className="vocab-dot" style={{ background: "var(--blue)" }} />
              <span className="vocab-stat-label">Фразы</span>
              <span className="vocab-stat-val">{phraseCards}</span>
            </div>
            <div className="vocab-stat">
              <span className="vocab-dot" style={{ background: "var(--accent)" }} />
              <span className="vocab-stat-label">Из книг</span>
              <span className="vocab-stat-val">{totalCards - wordCards - phraseCards}</span>
            </div>
          </div>
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
          <span className="action-card-label" style={{ color: "var(--green)" }}>Продолжить обучение</span>
          <strong className="action-card-title">Повтори слова и укрепи память</strong>
          <span className="action-card-sub">{totalCards} карточек · {LANG_NAMES[profile.targetLanguage] ?? profile.targetLanguage}</span>
        </span>
        <ChevronRight size={20} className="action-card-arrow" style={{ color: "var(--green)" }} />
      </button>
    </section>
  );
}
