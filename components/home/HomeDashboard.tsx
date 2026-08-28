"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronRight, Library, Flame, Phone, Headphones } from "lucide-react";
import { BookDetailModal } from "@/components/discover/BookDetailModal";
import { AudiobookDetailModal } from "@/components/discover/AudiobookDetailModal";
import type { Audiobook, Book, CefrLevel, Flashcard, UserProfile } from "@/lib/types";
import { useAuth } from "@/lib/auth/useAuth";
import { computeDeckStats, endOfTodayMs } from "@/lib/cards";
import { getCardVariantProgressMap } from "@/lib/db/local";
import {
  fetchAudiobooks,
  formatAudioDuration,
  getLastPlayedAudiobook,
  isLikelyAdvancedText,
  pickBestFitAudiobook,
} from "@/lib/audio/audiobooks";
import { estimateTargetLanguageLevel } from "@/lib/ai/userLevel";

type Props = {
  book: Book | null;
  books: Book[];
  profile: UserProfile;
  cards: Flashcard[];
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
  /** Book whose text is being fetched right now, so its tile can show a spinner. */
  openingBookId?: string | null;
  downloadTasks: Record<number, DownloadTask>;
  onDownloadBook: (book: GutendexBook) => void;
  onContinueReading: () => void;
  onOpenCards: () => void;
  onOpenBooks: () => void;
  onOpenDiscover: () => void;
  onOpenLiveChat: () => void;
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
  onOpenLiveChat,
}: Props) {
  const { user } = useAuth();
  const [recommendations, setRecommendations] = useState<GutendexBook[]>([]);
  const [topBooks, setTopBooks] = useState<GutendexBook[]>([]);
  const [isLoadingShelves, setIsLoadingShelves] = useState(true);
  const [selectedBook, setSelectedBook] = useState<GutendexBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalCards = cards.length;
  const activeLanguage = book?.language || profile.targetLanguage || "de";
  const libraryTitles = useMemo(() => new Set(books.map((item) => item.title.toLowerCase())), [books]);

  // The end of "today" only has to move when the day does — same boundary
  // CardsView ticks over, so a badge left open across midnight doesn't keep
  // showing yesterday's count (see docs/coordination/tasks/claude-audiobooks-home-improvements.md, item 6).
  const [todayEndTime, setTodayEndTime] = useState(endOfTodayMs);
  useEffect(() => {
    const id = setInterval(() => {
      setTodayEndTime((prev) => {
        const next = endOfTodayMs();
        return next === prev ? prev : next;
      });
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  // Counted the same way the card module counts it — every prompt direction,
  // not just the forward one, against the same today boundary — so the home
  // tile, the tab badge and the trainer's own due list can never disagree.
  const dueCardsCount = useMemo(
    () => computeDeckStats(cards, getCardVariantProgressMap(), new Date(todayEndTime)).dueCards,
    [cards, todayEndTime],
  );

  // ── The learner's own level, from books read and vocabulary size ──────────
  // Reuses the existing estimate (until now only fed to Live Chat's system
  // prompt) instead of hardcoding A1 or inventing a new source of truth.
  const [userLevel, setUserLevel] = useState<CefrLevel | null>(null);
  useEffect(() => {
    let active = true;
    estimateTargetLanguageLevel(profile.targetLanguage)
      .then((estimate) => { if (active) setUserLevel(estimate?.level ?? null); })
      .catch(() => { if (active) setUserLevel(null); });
    return () => { active = false; };
  }, [profile.targetLanguage]);

  // No confirmed level yet (brand-new learner) still shouldn't default to
  // showing advanced originals as ordinary recommendations — A1 is the safer
  // fallback for that guard specifically, never a claimed "matches your level".
  const isBeginnerLevel = (userLevel ?? "A1") === "A1" || (userLevel ?? "A1") === "A2";

  // ── Audiobooks: "Продолжить слушать" + "Лучше всего подходит вашему уровню" ─
  const [continueListening, setContinueListening] = useState<ReturnType<typeof getLastPlayedAudiobook>>(null);
  useEffect(() => {
    setContinueListening(getLastPlayedAudiobook());
  }, []);

  const continueListeningAudiobook = useMemo<Audiobook | null>(() => {
    if (!continueListening) return null;
    return {
      id: continueListening.audiobookId,
      title: continueListening.title || "Аудиокнига",
      author: continueListening.author || "Неизвестный автор",
      language: continueListening.language || profile.targetLanguage,
      cefrLevel: continueListening.cefrLevel ?? null,
      cefrConfidence: continueListening.cefrConfidence,
      coverUrl: continueListening.coverUrl ?? null,
      coverColor: continueListening.coverColor,
      sourceType: "librivox",
    };
  }, [continueListening, profile.targetLanguage]);

  const [bestFitAudiobook, setBestFitAudiobook] = useState<Audiobook | null>(null);
  useEffect(() => {
    // No confirmed level → nothing honest to call "matches your level"; hide
    // the block rather than guess (see item 4: approximate/unverified must
    // never stand in for a confirmed match).
    if (!userLevel) { setBestFitAudiobook(null); return; }

    let active = true;
    const controller = new AbortController();
    const cacheKey = `aibook:home-audio-best-fit:${profile.targetLanguage}:${userLevel}`;

    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) setBestFitAudiobook(JSON.parse(cached) as Audiobook);
    } catch {
      localStorage.removeItem(cacheKey);
    }

    fetchAudiobooks({ language: profile.targetLanguage, cefrLevel: userLevel, page: 1, pageSize: 12, signal: controller.signal })
      .then((res) => {
        if (!active) return;
        const match = pickBestFitAudiobook(res.audiobooks, userLevel);
        setBestFitAudiobook(match);
        try {
          if (match) localStorage.setItem(cacheKey, JSON.stringify(match));
          else localStorage.removeItem(cacheKey);
        } catch { /* ignore storage quota errors */ }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
      });

    return () => { active = false; controller.abort(); };
  }, [profile.targetLanguage, userLevel]);

  // Never show the same audiobook as both "continue" and "best fit".
  const bestFitAudiobookDisplayed = useMemo(
    () => (bestFitAudiobook && bestFitAudiobook.id !== continueListening?.audiobookId ? bestFitAudiobook : null),
    [bestFitAudiobook, continueListening],
  );

  const [openAudiobook, setOpenAudiobook] = useState<Audiobook | null>(null);

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

  // Gutendex's catalogue is uncurated public-domain literature — it has no
  // CEFR data of its own, so a beginner can't be shown a confirmed-level
  // match here the way the audiobook block can. What can be done honestly is
  // to keep obviously advanced originals (Goethe, Kant, Nietzsche, ...) out of
  // the ordinary recommendation shelves for an A1/A2 learner — see item 4:
  // "не выдавать сложные книги как обычные рекомендации".
  const filterForLevel = useMemo(
    () => (list: GutendexBook[]) =>
      isBeginnerLevel ? list.filter((b) => !isLikelyAdvancedText(b.title, b.authors?.[0]?.name)) : list,
    [isBeginnerLevel],
  );
  const displayedRecommendations = useMemo(() => filterForLevel(recommendations), [recommendations, filterForLevel]);
  const displayedTopBooks = useMemo(() => filterForLevel(topBooks), [topBooks, filterForLevel]);

  const bookOfDay = useMemo(() => {
    const pool = displayedRecommendations.length > 0 ? displayedRecommendations : displayedTopBooks;
    if (pool.length === 0) return null;
    return pool[dayOfYear() % pool.length];
  }, [displayedRecommendations, displayedTopBooks]);

  return (
    <section className="screen home-screen">
      <style>{`
        .action-card.study .action-card-arrow { color: var(--green); }
      `}</style>
      <header className="home-header">
        <div>
          <h1 className="home-title">AIBook</h1>
        </div>
        <div className="home-header-right">
          <button className="icon-btn livechat-fab" onClick={onOpenLiveChat} type="button" aria-label="Голосовой чат с AI">
            <Phone size={19} />
          </button>
          <button className="icon-btn" onClick={onOpenBooks} type="button" aria-label="Библиотека">
            <Library size={19} />
          </button>
        </div>
      </header>

      {!user && (
        <div 
          style={{
            padding: "14px 18px",
            background: "linear-gradient(135deg, rgba(212, 168, 71, 0.08) 0%, rgba(20, 18, 16, 0.2) 100%)",
            border: "1px solid rgba(212, 168, 71, 0.2)",
            borderRadius: "var(--radius-lg)",
            color: "var(--text-primary)",
            fontSize: "13px",
            lineHeight: "1.5",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            marginBottom: "20px",
            boxShadow: "var(--shadow-sm)"
          }}
        >
          <span style={{ fontWeight: 800, color: "var(--accent)", display: "flex", alignItems: "center", gap: "6px" }}>
            ☁️ Локальный офлайн-режим
          </span>
          <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
            Вы вошли как гость. Ваш прогресс чтения и карточки хранятся только в браузере. Зарегистрируйтесь, чтобы сохранять данные в облаке.
          </span>
        </div>
      )}

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
        <button className="action-card reading glass-card" onClick={onOpenBooks} type="button" style={{ marginBottom: 16 }}>
          <span className="action-card-icon"><BookOpen size={24} /></span>
          <span>
            <span className="action-card-label">Начать читать</span>
            <strong className="action-card-title">Загрузите первую книгу</strong>
            <span className="action-card-sub">TXT, EPUB или FB2</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      )}

      {/* «Продолжить слушать» — the last audiobook chapter the learner had
          open, restored from the same local progress store the player itself
          writes to (see saveAudiobookProgress). Hidden entirely when there is
          no listening history, rather than guessing at one. */}
      {continueListeningAudiobook && continueListening && (
        <div className="book-hero-card glass-card" style={{ marginBottom: 16 }}>
          <div
            className="book-hero-cover"
            style={
              continueListeningAudiobook.coverUrl
                ? { backgroundImage: `url(${continueListeningAudiobook.coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                : { background: continueListeningAudiobook.coverColor || "var(--accent)" }
            }
          >
            {!continueListeningAudiobook.coverUrl && <Headphones size={22} />}
          </div>
          <div className="book-hero-info">
            <span className="action-card-label" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Headphones size={13} /> Продолжить слушать
            </span>
            <strong className="book-hero-title">{continueListeningAudiobook.title}</strong>
            <span className="book-hero-author">{continueListeningAudiobook.author}</span>
            <div className="book-hero-progress">
              <div className="progress-bar">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${
                      continueListening.durationSeconds > 0
                        ? Math.min(100, Math.round((continueListening.currentTimeSeconds / continueListening.durationSeconds) * 100))
                        : 0
                    }%`,
                  }}
                />
              </div>
              <span>
                {continueListening.chapterTitle || `Глава ${continueListening.chapterIndex + 1}`}
                {continueListening.totalChapters ? ` из ${continueListening.totalChapters}` : ""}
                {" · "}
                {formatAudioDuration(continueListening.currentTimeSeconds)}
              </span>
            </div>
          </div>
          <button className="book-hero-cta" type="button" onClick={() => setOpenAudiobook(continueListeningAudiobook)}>
            Продолжить
          </button>
        </div>
      )}

      {/* Spaced Repetition action card */}
      {cards.length > 0 && (
        <button className="action-card study glass-card" onClick={onOpenCards} type="button" style={{ marginBottom: 16 }}>
          <span className="action-card-icon">
            <Flame size={24} fill={dueCardsCount > 0 ? "var(--green)" : "none"} style={{ color: dueCardsCount > 0 ? "var(--green)" : "var(--text-muted)" }} />
          </span>
          <span>
            <span className="action-card-label" style={{ color: dueCardsCount > 0 ? "var(--green)" : "var(--text-muted)" }}>
              {dueCardsCount > 0 ? "Есть карточки для повторения" : "Все карточки повторены"}
            </span>
            <strong className="action-card-title">
              {dueCardsCount > 0 ? `Повторить сегодня: ${dueCardsCount}` : "Интервальное повторение"}
            </strong>
            <span className="action-card-sub">
              {dueCardsCount > 0 
                ? "Укрепите нейронные связи прямо сейчас" 
                : `Всего изучено: ${cards.filter(c => c.repetitions > 0).length} из ${cards.length}`}
            </span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      )}

      {error && <div className="inline-error">{error}</div>}

      {isLoadingShelves || (displayedRecommendations.length === 0 && displayedTopBooks.length === 0) ? (
        <HomeShelvesSkeleton />
      ) : (
        <>
          <RecommendationShelf
            title={`На ${LANG_NAMES[activeLanguage] ?? activeLanguage}`}
            books={displayedRecommendations}
            onOpenDiscover={onOpenDiscover}
            onBookSelect={setSelectedBook}
          />

          <RecommendationShelf
            title="Лучшие книги"
            books={displayedTopBooks}
            onOpenDiscover={onOpenDiscover}
            onBookSelect={setSelectedBook}
          />
        </>
      )}

      {/* «Лучше всего подходит вашему уровню» — a single audiobook whose CEFR
          level is confirmed (or, failing that, clearly marked as approximate)
          against the learner's own estimated level. No confirmed level yet,
          or no match found at all, and the block simply doesn't render —
          never a guessed "matches your level" claim. */}
      {bestFitAudiobookDisplayed && userLevel && (
        <button className="book-of-day glass-card" type="button" onClick={() => setOpenAudiobook(bestFitAudiobookDisplayed)}>
          <span
            className="book-of-day-cover"
            style={
              bestFitAudiobookDisplayed.coverUrl
                ? { backgroundImage: `url(${bestFitAudiobookDisplayed.coverUrl})` }
                : { background: bestFitAudiobookDisplayed.coverColor || pickColor(bestFitAudiobookDisplayed.title) }
            }
          >
            {!bestFitAudiobookDisplayed.coverUrl && <Headphones size={18} />}
          </span>
          <span className="book-of-day-meta">
            <small>
              Лучше всего подходит вашему уровню
              {bestFitAudiobookDisplayed.cefrConfidence === "approximate" ? " (примерно)" : ""}
            </small>
            <strong>{bestFitAudiobookDisplayed.title}</strong>
            <em>{bestFitAudiobookDisplayed.author} · {bestFitAudiobookDisplayed.cefrLevel}</em>
          </span>
          <ChevronRight size={18} />
        </button>
      )}

      {bookOfDay && (
        <button className="book-of-day glass-card" type="button" onClick={() => setSelectedBook(bookOfDay)}>
          <span
            className="book-of-day-cover"
            style={getCoverUrl(bookOfDay) ? { backgroundImage: `url(${getCoverUrl(bookOfDay)})` } : { background: pickColor(bookOfDay.title) }}
          >
            {!getCoverUrl(bookOfDay) && (bookOfDay.languages?.[0] || "en").toUpperCase()}
          </span>
          <span className="book-of-day-meta">
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

      {openAudiobook && (
        <AudiobookDetailModal
          audiobook={openAudiobook}
          nativeLanguage={profile.nativeLanguage}
          onClose={() => {
            setOpenAudiobook(null);
            // Pick up whatever progress was just made, so the tile reflects
            // it without waiting for a full remount of the home screen.
            setContinueListening(getLastPlayedAudiobook());
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
