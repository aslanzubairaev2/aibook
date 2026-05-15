"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, Library } from "lucide-react";
import { BookDetailModal } from "@/components/discover/BookDetailModal";
import type { Book, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  book: Book | null;
  books: Book[];
  profile: UserProfile;
  cards: Flashcard[];
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
  downloadTasks: Record<number, DownloadTask>;
  onDownloadBook: (book: GutendexBook) => void;
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

type DownloadTask = {
  progress: number;
  status: "downloading" | "parsing" | "saving" | "done" | "error";
  message: string;
  bookLocalId?: string;
};

const LANG_NAMES: Record<string, string> = {
  ru: "Русский",
  de: "Deutsch",
  en: "English",
  fr: "Français",
  es: "Español",
  it: "Italiano",
};

const COVER_COLORS = [
  "linear-gradient(160deg, #c49a28 0%, #7a5c10 100%)",
  "linear-gradient(160deg, #4a7a5c 0%, #254030 100%)",
  "linear-gradient(160deg, #3a5c8a 0%, #1a2c4a 100%)",
  "linear-gradient(160deg, #8a3a3a 0%, #4a1a1a 100%)",
  "linear-gradient(160deg, #6a3a8a 0%, #35174a 100%)",
  "linear-gradient(160deg, #8a5a2a 0%, #4a2a0a 100%)",
];

function pickColor(title: string) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

function getCoverUrl(book: GutendexBook) {
  const coverKey = Object.keys(book.formats).find((key) => key.startsWith("image/jpeg"));
  return coverKey ? book.formats[coverKey].replace("http://", "https://").replace(".medium.", ".small.") : null;
}

function dayOfYear() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((Number(now) - Number(start)) / 86400000);
}

function bookKey(item: GutendexBook) {
  return item.title.trim().toLowerCase();
}

function makeUniqueShelf(items: GutendexBook[], blocked: Set<string>, limit = 9) {
  const seen = new Set(blocked);
  const shelf: GutendexBook[] = [];

  for (const item of items) {
    const key = bookKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    shelf.push(item);
    if (shelf.length >= limit) break;
  }

  return shelf;
}

export function HomeDashboard({
  book,
  books,
  profile,
  cards,
  onBooksChange,
  onOpenBook,
  downloadTasks,
  onDownloadBook,
  onContinueReading,
  onOpenCards,
  onOpenBooks,
  onOpenDiscover,
}: Props) {
  const [recommendations, setRecommendations] = useState<GutendexBook[]>([]);
  const [topBooks, setTopBooks] = useState<GutendexBook[]>([]);
  const [isLoadingShelves, setIsLoadingShelves] = useState(true);
  const [selectedBook, setSelectedBook] = useState<GutendexBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalCards = cards.length;
  const activeLanguage = book?.language || profile.targetLanguage || "de";
  const libraryTitles = useMemo(() => new Set(books.map((item) => item.title.toLowerCase())), [books]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadShelf(language: string) {
      setIsLoadingShelves(true);
      const cacheKey = `aibook:home-shelves:${language}`;
      const blockedByLibrary = new Set(libraryTitles);

      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { languageBooks?: GutendexBook[]; popularBooks?: GutendexBook[] };
          const languageShelf = makeUniqueShelf(parsed.languageBooks ?? [], blockedByLibrary);
          const blockedAfterLanguage = new Set([...blockedByLibrary, ...languageShelf.map(bookKey)]);
          const popularShelf = makeUniqueShelf(parsed.popularBooks ?? [], blockedAfterLanguage);

          if (languageShelf.length > 0 || popularShelf.length > 0) {
            setRecommendations(languageShelf);
            setTopBooks(popularShelf);
            setIsLoadingShelves(false);
          }
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }

      try {
        const [langRes, topRes] = await Promise.all([
          fetch(`https://gutendex.com/books/?sort=popular&languages=${language}&mime_type=image/jpeg`, { signal: controller.signal }),
          fetch("https://gutendex.com/books/?sort=popular&page=2&mime_type=image/jpeg", { signal: controller.signal }),
        ]);

        if (!langRes.ok || !topRes.ok) return;

        const [langData, topData] = await Promise.all([langRes.json(), topRes.json()]);
        const languageBooks = (langData.results as GutendexBook[]) ?? [];
        const popularBooks = (topData.results as GutendexBook[]) ?? [];
        const languageShelf = makeUniqueShelf(languageBooks, blockedByLibrary);
        const blockedAfterLanguage = new Set([...blockedByLibrary, ...languageShelf.map(bookKey)]);

        setRecommendations(languageShelf);
        setTopBooks(makeUniqueShelf(popularBooks, blockedAfterLanguage));
        localStorage.setItem(cacheKey, JSON.stringify({ languageBooks, popularBooks }));
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      } finally {
        setIsLoadingShelves(false);
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
            <span className="action-card-sub">TXT, EPUB или FB2</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      )}

      {error && <div className="inline-error">{error}</div>}

      {isLoadingShelves || (recommendations.length === 0 && topBooks.length === 0) ? (
        <HomeShelvesSkeleton />
      ) : (
        <>
          <RecommendationShelf
            title={`На ${LANG_NAMES[activeLanguage] ?? activeLanguage}`}
            books={recommendations}
            onOpenDiscover={onOpenDiscover}
            onBookSelect={setSelectedBook}
          />

          <RecommendationShelf
            title="Лучшие книги"
            books={topBooks}
            onOpenDiscover={onOpenDiscover}
            onBookSelect={setSelectedBook}
          />
        </>
      )}

      {bookOfDay && (
        <button className="book-of-day glass-card" type="button" onClick={() => setSelectedBook(bookOfDay)}>
          <span
            className="book-of-day-cover"
            style={getCoverUrl(bookOfDay) ? { backgroundImage: `url(${getCoverUrl(bookOfDay)})` } : { background: pickColor(bookOfDay.title) }}
          >
            {!getCoverUrl(bookOfDay) && (bookOfDay.languages?.[0] || "en").toUpperCase()}
          </span>
          <span>
            <small>Книга дня</small>
            <strong>{bookOfDay.title}</strong>
            <em>{bookOfDay.authors?.[0]?.name || "Неизвестен"}</em>
          </span>
          <ChevronRight size={18} />
        </button>
      )}

      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          coverUrl={getCoverUrl(selectedBook)}
          coverColor={pickColor(selectedBook.title)}
          inLibrary={books.some((item) => item.title.toLowerCase() === selectedBook.title.toLowerCase())}
          downloadTask={downloadTasks[selectedBook.id]}
          isDownloading={downloadTasks[selectedBook.id]?.status === "downloading" || downloadTasks[selectedBook.id]?.status === "parsing" || downloadTasks[selectedBook.id]?.status === "saving"}
          onClose={() => setSelectedBook(null)}
          onDownload={() => onDownloadBook(selectedBook)}
          onOpen={() => {
            const existing = books.find((item) => item.title.toLowerCase() === selectedBook.title.toLowerCase());
            if (existing) {
              setSelectedBook(null);
              onOpenBook(existing);
            }
          }}
        />
      )}
    </section>
  );
}

function RecommendationShelf({
  title,
  books,
  onOpenDiscover,
  onBookSelect,
}: {
  title: string;
  books: GutendexBook[];
  onOpenDiscover: () => void;
  onBookSelect: (book: GutendexBook) => void;
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
            <button key={item.id} className="shelf-book" type="button" onClick={() => onBookSelect(item)}>
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

function HomeShelvesSkeleton() {
  return (
    <>
      {[0, 1].map((section) => (
        <section className="recommendation-section" key={section}>
          <div className="shelf-title-skeleton shimmer-line" />
          <div className="book-shelf">
            {Array.from({ length: 6 }).map((_, index) => (
              <div className="shelf-book-skeleton" key={index}>
                <span className="shelf-cover skeleton-block" />
                <span className="shimmer-line short" />
                <span className="shimmer-line medium" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
