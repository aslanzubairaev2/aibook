"use client";

import { useState, useEffect } from "react";
import { Search, Globe, ChevronDown } from "lucide-react";
import { parseBook } from "@/lib/parser/index";
import { saveLocalBook } from "@/lib/db/local";
import { sbUpsertBook, sbUpsertChapter } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import type { Book } from "@/lib/types";
import { franc } from "franc-min";
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

export function DiscoverView({ books, onBooksChange, onOpenBook }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [language, setLanguage] = useState(""); // "" means all
  const [results, setResults] = useState<GutendexBook[]>([]);
  const [nextUrl, setNextUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  
  const [selectedBook, setSelectedBook] = useState<GutendexBook | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load some initial trending books
  useEffect(() => {
    void fetchBooks("");
  }, []);

  async function fetchBooks(searchQuery: string, loadMoreUrl: string | null = null) {
    if (loadMoreUrl) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
    }
    setError(null);
    try {
      let url = loadMoreUrl;
      if (!url) {
        url = `https://gutendex.com/books/?sort=popular`;
        if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
        if (language) url += `&languages=${language}`;
      }
      
      const res = await fetch(url);
      if (!res.ok) throw new Error("Ошибка при загрузке каталога");
      const data = await res.json();
      
      // Filter for books that have plain text format
      const validBooks = data.results.filter((b: GutendexBook) => {
        return Object.keys(b.formats).some(k => k.startsWith("text/plain"));
      });
      
      setResults(prev => loadMoreUrl ? [...prev, ...validBooks] : validBooks);
      setNextUrl(data.next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }

  // Reload when language changes
  useEffect(() => {
    void fetchBooks(query);
  }, [language]);

  async function handleDownload(bookInfo: GutendexBook) {
    // Check if already in library
    const existing = books.find(b => b.title === bookInfo.title);
    if (existing) {
      onOpenBook(existing);
      return;
    }

    setDownloadingId(bookInfo.id);
    setError(null);

    try {
      // Find a plain text url
      const textKey = Object.keys(bookInfo.formats).find(k => k.startsWith("text/plain"));
      if (!textKey) throw new Error("Текст книги недоступен");
      
      let textUrl = bookInfo.formats[textKey];
      // Sometimes Gutendex returns http:// links which can cause mixed content. Force https:
      textUrl = textUrl.replace("http://", "https://");

      const res = await fetch(textUrl);
      if (!res.ok) throw new Error("Не удалось скачать текст");
      const textBuffer = await res.arrayBuffer();
      const file = new File([textBuffer], `${bookInfo.title}.txt`, { type: "text/plain" });

      const paragraphs = await parseBook(file);
      if (paragraphs.length === 0) throw new Error("Файл пустой или не удалось разобрать текст");

      const bookId = crypto.randomUUID();
      const coverColor = pickColor(bookInfo.title);
      const author = bookInfo.authors?.[0]?.name || "Неизвестен";
      
      // Auto-detect language or fallback to Gutendex lang
      const sampleText = paragraphs.slice(0, 50).join(" ");
      const iso639_3 = franc(sampleText);
      const langMap: Record<string, string> = {
        deu: "de", eng: "en", spa: "es", fra: "fr", ita: "it", rus: "ru"
      };
      let detectedLang = langMap[iso639_3];
      if (!detectedLang) {
        // Gutendex uses 2-letter codes mostly
        detectedLang = bookInfo.languages?.[0] || "en";
      }

      // Try to get cover image
      const coverKey = Object.keys(bookInfo.formats).find(k => k.startsWith("image/jpeg"));
      const coverUrl = coverKey ? bookInfo.formats[coverKey].replace("http://", "https://") : null;

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
    <section className="screen">
      <header className="screen-header" style={{ marginBottom: 24 }}>
        <div>
          <p className="eyebrow">Каталог</p>
          <h1>Открытая библиотека</h1>
        </div>
      </header>

      <div style={{ position: "relative", marginBottom: 16 }}>
        <input 
          type="text" 
          placeholder="Поиск по названию или автору..." 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void fetchBooks(query)}
          style={{
            width: "100%",
            padding: "16px 20px 16px 52px",
            borderRadius: 12,
            border: "1px solid var(--border)",
            background: "var(--card-bg)",
            color: "var(--text)",
            fontSize: 16,
            outline: "none",
            boxShadow: "0 2px 8px rgba(0,0,0,0.05)"
          }}
        />
        <Search 
          size={20} 
          style={{ position: "absolute", left: 20, top: "50%", transform: "translateY(-50%)", color: "var(--text-tertiary)" }} 
        />
        <button
          onClick={() => void fetchBooks(query)}
          className="pill-btn"
          style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", padding: "8px 16px" }}
        >
          Искать
        </button>
      </div>

      <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 12, marginBottom: 20, scrollbarWidth: "none" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <select 
            value={language} 
            onChange={(e) => setLanguage(e.target.value)}
            style={{
              appearance: "none",
              padding: "8px 36px 8px 16px",
              borderRadius: 20,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              fontSize: 14,
              fontWeight: 500,
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value="">Все языки</option>
            <option value="en">Английский</option>
            <option value="de">Немецкий</option>
            <option value="fr">Французский</option>
            <option value="es">Испанский</option>
            <option value="it">Итальянский</option>
          </select>
          <ChevronDown size={16} style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: "var(--text-secondary)" }} />
        </div>
        
        {/* Topic suggestions */}
        {["children", "fairy tales", "science", "history"].map(topic => (
          <button 
            key={topic}
            onClick={() => { setQuery(topic); void fetchBooks(topic); }}
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              color: "var(--text-secondary)",
              fontSize: 14,
              fontWeight: 500,
              flexShrink: 0,
              cursor: "pointer"
            }}
          >
            {topic}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 8, background: "rgba(196,106,106,0.15)", border: "1px solid rgba(196,106,106,0.3)", color: "#e08888", fontSize: 14 }}>
          {error}
        </div>
      )}

      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "var(--text-secondary)" }}>
          <div className="shimmer-line" style={{ width: 40, height: 40, borderRadius: "50%", margin: "0 auto 16px" }} />
          <span>Ищем интересные книги...</span>
        </div>
      ) : results.length === 0 ? (
        <div className="empty-state">
          <Globe size={40} />
          <strong>Книги не найдены</strong>
          <p>Попробуйте изменить запрос</p>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 16 }}>
            {results.map((bookInfo) => {
              const coverKey = Object.keys(bookInfo.formats).find(k => k.startsWith("image/jpeg"));
              const coverUrl = coverKey ? bookInfo.formats[coverKey].replace("http://", "https://") : null;
              const coverColor = pickColor(bookInfo.title);

              return (
                <div 
                  key={bookInfo.id} 
                  onClick={() => setSelectedBook(bookInfo)}
                  style={{ 
                    display: "flex", 
                    flexDirection: "column", 
                    background: "var(--card-bg)", 
                    borderRadius: 12,
                    overflow: "hidden",
                    border: "1px solid var(--border)",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                    cursor: "pointer",
                    transition: "transform 0.2s, box-shadow 0.2s"
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.boxShadow = "0 8px 24px rgba(0,0,0,0.12)";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.05)";
                  }}
                >
                  <div 
                    style={{
                      width: "100%",
                      aspectRatio: "2/3",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgba(255,255,255,0.8)",
                      fontSize: "1.2rem",
                      fontWeight: "bold",
                      ...(coverUrl 
                        ? { backgroundImage: `url(${coverUrl})`, backgroundSize: "cover", backgroundPosition: "center" } 
                        : { background: coverColor })
                    }}
                  >
                    {!coverUrl && (bookInfo.languages?.[0] || "en").toUpperCase()}
                  </div>
                  <div style={{ padding: "12px", display: "flex", flexDirection: "column", flexGrow: 1 }}>
                    <strong style={{ fontSize: 14, marginBottom: 4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.2 }}>
                      {bookInfo.title}
                    </strong>
                    <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {bookInfo.authors?.[0]?.name || "Неизвестен"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {nextUrl && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: 32, paddingBottom: 32 }}>
              <button 
                onClick={() => void fetchBooks(query, nextUrl)} 
                className="pill-btn" 
                disabled={isLoadingMore}
                style={{ padding: "12px 24px" }}
              >
                {isLoadingMore ? "Загрузка..." : "Загрузить ещё"}
              </button>
            </div>
          )}
        </>
      )}

      {selectedBook && (
        <BookDetailModal 
          book={selectedBook}
          coverUrl={Object.keys(selectedBook.formats).find(k => k.startsWith("image/jpeg")) ? selectedBook.formats[Object.keys(selectedBook.formats).find(k => k.startsWith("image/jpeg"))!].replace("http://", "https://") : null}
          coverColor={pickColor(selectedBook.title)}
          inLibrary={books.some(b => b.title === selectedBook.title)}
          isDownloading={downloadingId === selectedBook.id}
          onClose={() => setSelectedBook(null)}
          onDownload={() => void handleDownload(selectedBook)}
          onOpen={() => {
            const existing = books.find(b => b.title === selectedBook.title);
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
