"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Globe, Search, X } from "lucide-react";
import { franc } from "franc-min";
import { parseBook } from "@/lib/parser/index";
import { saveLocalBook } from "@/lib/db/local";
import { sbUpsertBook, sbUpsertChapter } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import type { Book } from "@/lib/types";
import { BookDetailModal } from "./BookDetailModal";

type Props = {
  books: Book[];
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
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

const PAGE_SIZE = 32;

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
  return coverKey ? book.formats[coverKey].replace("http://", "https://") : null;
}

function hasText(book: GutendexBook) {
  return Object.keys(book.formats).some((key) => key.startsWith("text/plain"));
}

function buildCatalogUrl(searchQuery: string, language: string, page: number) {
  const params = new URLSearchParams({
    sort: "popular",
    page: String(page),
  });

  if (searchQuery.trim()) params.set("search", searchQuery.trim());
  if (language) params.set("languages", language);

  return `https://gutendex.com/books/?${params.toString()}`;
}

export function DiscoverView({ books, onBooksChange, onOpenBook }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [page, setPage] = useState(1);
  const [count, setCount] = useState(0);
  const [results, setResults] = useState<GutendexBook[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedBook, setSelectedBook] = useState<GutendexBook | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
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
      try {
        const res = await fetch(buildCatalogUrl(submittedQuery, language, page), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error("Ошибка при загрузке каталога");

        const data = (await res.json()) as GutendexResponse;
        setResults(data.results.filter(hasText));
        setCount(data.count);
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

  async function handleDownload(bookInfo: GutendexBook) {
    const existing = books.find((book) => book.title.toLowerCase() === bookInfo.title.toLowerCase());
    if (existing) {
      onOpenBook(existing);
      return;
    }

    setDownloadingId(bookInfo.id);
    setError(null);

    try {
      const textKey = Object.keys(bookInfo.formats).find((key) => key.startsWith("text/plain"));
      if (!textKey) throw new Error("Текст книги недоступен");

      const textUrl = bookInfo.formats[textKey].replace("http://", "https://");
      const res = await fetch(`/api/books/proxy?url=${encodeURIComponent(textUrl)}`);
      if (!res.ok) throw new Error("Не удалось скачать текст книги");

      const textBuffer = await res.arrayBuffer();
      const file = new File([textBuffer], `${bookInfo.title}.txt`, { type: "text/plain" });
      const paragraphs = await parseBook(file);
      if (paragraphs.length === 0) throw new Error("Файл пустой или не удалось разобрать текст");

      const sampleText = paragraphs.slice(0, 50).join(" ");
      const langMap: Record<string, string> = {
        deu: "de",
        eng: "en",
        spa: "es",
        fra: "fr",
        ita: "it",
        rus: "ru",
      };
      const detectedLang = langMap[franc(sampleText)] || bookInfo.languages?.[0] || "en";
      const bookId = crypto.randomUUID();
      const author = bookInfo.authors?.[0]?.name || "Неизвестен";
      const coverColor = pickColor(bookInfo.title);
      const coverUrl = getCoverUrl(bookInfo);

      const newBook: Book = {
        id: bookId,
        title: bookInfo.title,
        author,
        language: detectedLang,
        format: "txt",
        progress: 0,
        paragraphIndex: 0,
        chapterTitle: "Начало",
        lastReadAt: new Date().toLocaleDateString("ru"),
        coverColor,
        coverUrl,
        paragraphs,
      };

      saveLocalBook(newBook);
      onBooksChange([newBook, ...books]);

      if (user) {
        const savedId = await sbUpsertBook({
          id: bookId,
          user_id: user.id,
          title: bookInfo.title,
          author,
          language: detectedLang,
          format: "txt",
          file_path: `${bookInfo.id}.txt`,
          cover_url: coverUrl,
          total_chars: paragraphs.join("").length,
          cover_color: coverColor,
        });

        if (savedId) {
          await sbUpsertChapter({
            id: crypto.randomUUID(),
            user_id: user.id,
            book_id: savedId,
            chapter_index: 0,
            title: "Начало",
            paragraphs,
            plain_text: paragraphs.join("\n"),
            char_count: paragraphs.join("").length,
          });
        }
      }

      onOpenBook(newBook);
      setSelectedBook(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при загрузке книги");
    } finally {
      setDownloadingId(null);
    }
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

      <div className="discover-meta">
        <span>{isSearching ? "Уточняю поиск..." : `${count || results.length} книг`}</span>
        <span>Страница {page} из {totalPages}</span>
      </div>

      {isLoading ? (
        <div className="catalog-loading">
          <span className="loading-dot" />
          <span>Ищем книги...</span>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <Globe size={40} />
          <strong>Книги не найдены</strong>
          <p>Попробуйте другой запрос или язык</p>
        </div>
      ) : (
        <>
          <div className="discover-grid">
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
          isDownloading={downloadingId === selectedBook.id}
          onClose={() => setSelectedBook(null)}
          onDownload={() => void handleDownload(selectedBook)}
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
