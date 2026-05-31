"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Globe, Search, X } from "lucide-react";
import type { Book } from "@/lib/types";
import { BookDetailModal } from "./BookDetailModal";

type Props = {
  books: Book[];
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
  downloadTasks: Record<number, DownloadTask>;
  onDownloadBook: (book: GutendexBook) => void;
};

type GutendexBook = {
  id: number;
  title: string;
  authors: { name: string }[];
  languages: string[];
  formats: Record<string, string>;
};

type GutendexResponse = {
  count: number;
  next: string | null;
  previous: string | null;
  results: GutendexBook[];
};

type DownloadTask = {
  progress: number;
  status: "downloading" | "parsing" | "saving" | "done" | "error";
  message: string;
  bookLocalId?: string;
};

const PAGE_SIZE = 18;

const LANGUAGES = [
  { value: "", label: "Все языки" },
  { value: "en", label: "Английский" },
  { value: "de", label: "Немецкий" },
  { value: "fr", label: "Французский" },
  { value: "es", label: "Испанский" },
  { value: "it", label: "Итальянский" },
  { value: "ru", label: "Русский" },
];

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

function hasText(book: GutendexBook) {
  return Object.keys(book.formats).some((key) => key.startsWith("text/plain"));
}

function buildCatalogUrl(searchQuery: string, language: string, page: number) {
  const params = new URLSearchParams({
    sort: "popular",
    page: String(page),
    page_size: String(PAGE_SIZE),
  });

  if (searchQuery.trim()) params.set("search", searchQuery.trim());
  if (language) params.set("languages", language);

  return `https://gutendex.com/books/?${params.toString()}`;
}

export function DiscoverView({ books, onOpenBook, downloadTasks, onDownloadBook }: Props) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [results, setResults] = useState<GutendexBook[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState<GutendexBook | null>(null);
  const [error, setError] = useState<string | null>(null);

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const isSearching = query.trim() !== submittedQuery.trim();

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextQuery = query.trim();
      if (nextQuery !== submittedQuery) {
        setSubmittedQuery(nextQuery);
        setPage(1);
      }
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [query, submittedQuery]);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchBooks() {
      setIsLoading(true);
      setError(null);
      const url = buildCatalogUrl(submittedQuery, language, page);
      const cacheKey = `aibook:catalog:${url}`;

      let hasCachedData = false;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const cachedData = JSON.parse(cached) as GutendexResponse;
          setResults(cachedData.results.filter(hasText).slice(0, PAGE_SIZE));
          setCount(cachedData.count);
          hasCachedData = true;
        }
      } catch {
        localStorage.removeItem(cacheKey);
      }

      // No cache — clear stale results so skeleton renders immediately
      if (!hasCachedData) setResults([]);

      try {
        const res = await fetch(url, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Ошибка при загрузке каталога");

        const data = (await res.json()) as GutendexResponse;
        setResults(data.results.filter(hasText).slice(0, PAGE_SIZE));
        setCount(data.count);
        localStorage.setItem(cacheKey, JSON.stringify(data));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Неизвестная ошибка");
      } finally {
        setIsLoading(false);
      }
    }

    void fetchBooks();
    return () => controller.abort();
  }, [submittedQuery, language, page]);

  const titleSet = useMemo(() => new Set(books.map((book) => book.title.toLowerCase())), [books]);

  function submitSearch() {
    setSubmittedQuery(query.trim());
    setPage(1);
  }

  function clearSearch() {
    setQuery("");
    setSubmittedQuery("");
    setPage(1);
  }

  return (
    <section className="screen discover-screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Каталог</p>
          <h1>Открытая библиотека</h1>
        </div>
      </header>

      <div className="discover-toolbar">
        <div className="discover-search">
          <Search size={18} aria-hidden />
          <input
            type="text"
            placeholder="Название, автор, тема"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitSearch();
              if (event.key === "Escape") clearSearch();
            }}
          />
          {query && (
            <button type="button" className="discover-clear" onClick={clearSearch} aria-label="Очистить поиск">
              <X size={16} />
            </button>
          )}
        </div>

        <button type="button" className="pill-btn discover-submit" onClick={submitSearch}>
          Найти
        </button>

        <div className="discover-language">
          <select
            value={language}
            onChange={(event) => {
              setLanguage(event.target.value);
              setPage(1);
            }}
            aria-label="Язык"
          >
            {LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <ChevronDown size={15} aria-hidden />
        </div>
      </div>

      {error && <div className="inline-error">{error}</div>}
      {isLoading && (
        <div className="catalog-loading-inline">
          <span className="loading-dot" />
          <span>{"\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u044e \u043a\u0430\u0442\u0430\u043b\u043e\u0433..."}</span>
        </div>
      )}

      <div className="discover-meta">
        <span>{isSearching ? "Уточняю поиск..." : `${count || results.length} книг`}</span>
        <span>Страница {page} из {totalPages}</span>
      </div>

      {isLoading && results.length === 0 ? (
        <CatalogSkeleton />
      ) : results.length === 0 ? (
        <div className="empty-state">
          <Globe size={40} />
          <strong>Книги не найдены</strong>
          <p>Попробуйте другой запрос или язык</p>
        </div>
      ) : (
        <>
          <div className={`discover-grid${isLoading ? " is-refreshing" : ""}`}>
            {results.map((bookInfo) => {
              const coverUrl = getCoverUrl(bookInfo);
              const isInLibrary = titleSet.has(bookInfo.title.toLowerCase());

              return (
                <button
                  key={bookInfo.id}
                  type="button"
                  className="catalog-book"
                  onClick={() => setSelectedBook(bookInfo)}
                >
                  <span
                    className="catalog-cover"
                    style={
                      coverUrl
                        ? { backgroundImage: `url(${coverUrl})` }
                        : { background: pickColor(bookInfo.title) }
                    }
                  >
                    {!coverUrl && (bookInfo.languages?.[0] || "en").toUpperCase()}
                  </span>
                  <span className="catalog-book-body">
                    <strong>{bookInfo.title}</strong>
                    <span>{bookInfo.authors?.[0]?.name || "Неизвестен"}</span>
                    {isInLibrary && <em>В библиотеке</em>}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="pager">
            <button
              type="button"
              className="mini-btn"
              disabled={page <= 1 || isLoading}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              <ChevronLeft size={15} />
              Назад
            </button>
            <span>{page} / {totalPages}</span>
            <button
              type="button"
              className="mini-btn"
              disabled={page >= totalPages || isLoading}
              onClick={() => setPage((value) => value + 1)}
            >
              Вперёд
              <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}

      {selectedBook && (
        <BookDetailModal
          book={selectedBook}
          coverUrl={getCoverUrl(selectedBook)}
          coverColor={pickColor(selectedBook.title)}
          inLibrary={books.some((book) => book.title.toLowerCase() === selectedBook.title.toLowerCase())}
          downloadTask={downloadTasks[selectedBook.id]}
          isDownloading={downloadTasks[selectedBook.id]?.status === "downloading" || downloadTasks[selectedBook.id]?.status === "parsing" || downloadTasks[selectedBook.id]?.status === "saving"}
          onClose={() => setSelectedBook(null)}
          onDownload={() => onDownloadBook(selectedBook)}
          onOpen={() => {
            const existing = books.find((book) => book.title.toLowerCase() === selectedBook.title.toLowerCase());
            if (existing) {
              onOpenBook(existing);
              setSelectedBook(null);
            }
          }}
        />
      )}
    </section>
  );
}

function CatalogSkeleton() {
  return (
    <div className="discover-grid">
      {Array.from({ length: 8 }).map((_, index) => (
        <div className="catalog-book catalog-book-skeleton" key={index}>
          <span className="catalog-cover skeleton-block" />
          <span className="catalog-book-body">
            <span className="shimmer-line" />
            <span className="shimmer-line medium" />
          </span>
        </div>
      ))}
    </div>
  );
}
