"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, Library, Sparkles, SquareStack } from "lucide-react";
import type { Book, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  book: Book | null;
  books: Book[];
  profile: UserProfile;
  cards: Flashcard[];
  onContinueReading: () => void;
  onOpenCards: () => void;
  onOpenBooks: () => void;
  onOpenDiscover: () => void;
};

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string }[];
  languages: string[];
  formats: Record<string, string>;
};

const LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  de: "Deutsch",
  en: "English",
  fr: "Français",
  es: "Español",
  it: "Italiano",
};

function getCoverUrl(book: GutendexBook) {
  const coverKey = Object.keys(book.formats).find((key) => key.startsWith("image/jpeg"));
  return coverKey ? book.formats[coverKey].replace("http://", "https://") : null;
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((Number(now) - Number(start)) / 86400000);
}

export function HomeDashboard({
  book,
  books,
  profile,
  cards,
  onContinueReading,
  onOpenCards,
  onOpenBooks,
  onOpenDiscover,
}: Props) {
  const [recommendations, setRecommendations] = useState<GutendexBook[]>([]);
  const [topBooks, setTopBooks] = useState<GutendexBook[]>([]);

  const totalCards = cards.length;
  const wordCards = cards.filter((card) => card.type === "word").length;
  const phraseCards = cards.filter((card) => card.type === "phrase").length;
  const activeLanguage = book?.language || profile.targetLanguage || "de";
  const libraryTitles = useMemo(() => new Set(books.map((item) => item.title.toLowerCase())), [books]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadShelf(language: string) {
      try {
        const [langRes, topRes] = await Promise.all([
          fetch(`https://gutendex.com/books/?sort=popular&languages=${language}`, { signal: controller.signal }),
          fetch("https://gutendex.com/books/?sort=popular", { signal: controller.signal }),
        ]);

        if (!langRes.ok || !topRes.ok) return;

        const [langData, topData] = await Promise.all([langRes.json(), topRes.json()]);
        const filterNew = (item: GutendexBook) => !libraryTitles.has(item.title.toLowerCase());

        setRecommendations((langData.results as GutendexBook[]).filter(filterNew).slice(0, 10));
        setTopBooks((topData.results as GutendexBook[]).filter(filterNew).slice(0, 10));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    void loadShelf(activeLanguage);
    return () => controller.abort();
  }, [activeLanguage, libraryTitles]);

  const bookOfDay = useMemo(() => {
    const pool = recommendations.length > 0 ? recommendations : topBooks;
    if (pool.length === 0) return null;
    return pool[dayOfYear() % pool.length];
  }, [recommendations, topBooks]);

  return (
    <section className="screen home-screen">
      <header className="home-header">
        <div>
          <h1 className="home-title">Твой учебный день</h1>
        </div>
        <div className="home-header-right">
          <span className="home-streak">{totalCards}</span>
          <button className="icon-btn" onClick={onOpenBooks} type="button" aria-label="Библиотека">
            <Library size={19} />
          </button>
        </div>
      </header>

      {book ? (
        <div className="book-hero-card glass-card">
          <div
            className="book-hero-cover"
            style={
              book.coverUrl
                ? { backgroundImage: `url(${book.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { background: book.coverColor }
            }
          >
            {!book.coverUrl && <span className="book-hero-lang">{book.language.toUpperCase()}</span>}
          </div>
          <div className="book-hero-info">
            <strong className="book-hero-title">{book.title}</strong>
            <span className="book-hero-author">{book.author}</span>
            <div className="book-hero-progress">
              <div className="progress-bar">
                <div className="progress-bar-fill" style={{ width: `${book.progress}%` }} />
              </div>
              <span>{book.chapterTitle} · {Math.round(book.progress)}%</span>
            </div>
          </div>
          <button className="book-hero-cta" type="button" onClick={onContinueReading}>
            Продолжить
          </button>
        </div>
      ) : (
        <button className="action-card reading glass-card" onClick={onOpenBooks} type="button">
          <span className="action-card-icon"><BookOpen size={24} /></span>
          <span>
            <span className="action-card-label">Начать читать</span>
            <strong className="action-card-title">Загрузите первую книгу</strong>
            <span className="action-card-sub">TXT или EPUB</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      )}

      <RecommendationShelf
        title={`На ${LANG_NAMES[activeLanguage] ?? activeLanguage}`}
        books={recommendations}
        onOpenDiscover={onOpenDiscover}
      />

      <RecommendationShelf
        title="Лучшие книги"
        books={topBooks}
        onOpenDiscover={onOpenDiscover}
      />

      {bookOfDay && (
        <button className="book-of-day glass-card" type="button" onClick={onOpenDiscover}>
          <span className="book-of-day-icon"><Sparkles size={17} /></span>
          <span>
            <small>Книга дня</small>
            <strong>{bookOfDay.title}</strong>
            <em>{bookOfDay.authors?.[0]?.name || "Неизвестен"}</em>
          </span>
          <ChevronRight size={18} />
        </button>
      )}

      <div className="vocab-section glass-card">
        <div className="vocab-header">
          <span className="vocab-title">Словарный прогресс</span>
          <span className="vocab-today">На сегодня</span>
        </div>
        <div className="vocab-grid">
          <div className="vocab-ring-wrap">
            <svg viewBox="0 0 80 80" className="vocab-ring" aria-hidden>
              <circle cx="40" cy="40" r="32" fill="none" strokeWidth="6" stroke="rgba(240,230,211,0.08)" />
              <circle
                cx="40"
                cy="40"
                r="32"
                fill="none"
                strokeWidth="6"
                stroke="var(--accent)"
                strokeLinecap="round"
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
              <span className="vocab-stat-val">{Math.max(0, totalCards - wordCards - phraseCards)}</span>
            </div>
          </div>
        </div>
      </div>

      <button className="action-card study glass-card" onClick={onOpenCards} type="button">
        <span className="action-card-icon"><SquareStack size={24} /></span>
        <span>
          <span className="action-card-label">Продолжить обучение</span>
          <strong className="action-card-title">Повтори слова и укрепи память</strong>
          <span className="action-card-sub">{totalCards} карточек · {LANG_NAMES[profile.targetLanguage] ?? profile.targetLanguage}</span>
        </span>
        <ChevronRight size={20} className="action-card-arrow" />
      </button>
    </section>
  );
}

function RecommendationShelf({
  title,
  books,
  onOpenDiscover,
}: {
  title: string;
  books: GutendexBook[];
  onOpenDiscover: () => void;
}) {
  if (books.length === 0) return null;

  return (
    <section className="recommendation-section">
      <button className="shelf-title" type="button" onClick={onOpenDiscover}>
        <span>{title}</span>
        <ChevronRight size={17} />
      </button>
      <div className="book-shelf">
        {books.map((item) => {
          const coverUrl = getCoverUrl(item);
          return (
            <button key={item.id} className="shelf-book" type="button" onClick={onOpenDiscover}>
              <span
                className="shelf-cover"
                style={coverUrl ? { backgroundImage: `url(${coverUrl})` } : undefined}
              >
                {!coverUrl && (item.languages?.[0] || "en").toUpperCase()}
              </span>
              <strong>{item.title}</strong>
              <em>{item.authors?.[0]?.name || "Неизвестен"}</em>
            </button>
          );
        })}
      </div>
    </section>
  );
}
