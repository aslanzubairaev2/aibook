"use client";

import { useRef, useState } from "react";
import { BookOpen, Trash2, Upload, Plus, FileText, Globe } from "lucide-react";
import { parseBook } from "@/lib/parser/index";
import { saveLocalBook, deleteLocalBook } from "@/lib/db/local";
import { sbUpsertBook, sbUpsertChapter, sbDeleteBook } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";
import { BOOK_FORMATS } from "@/lib/config";
import type { Book, AppSection } from "@/lib/types";

import { franc } from "franc-min";

type Props = {
  books: Book[];
  activeBookId: string | null;
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
  onNavigate: (section: AppSection) => void;
  defaultLanguage: string;
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

export function LibraryView({ books, activeBookId, onBooksChange, onOpenBook, onNavigate, defaultLanguage }: Props) {
  const { user } = useAuth();
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!ext || !(BOOK_FORMATS as readonly string[]).includes(`.${ext}`)) {
      setError(`Поддерживаются только ${BOOK_FORMATS.join(", ")}`);
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      const paragraphs = await parseBook(file);
      if (paragraphs.length === 0) throw new Error("Файл пустой или не удалось разобрать текст");

      const title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
      const bookId = crypto.randomUUID();
      const coverColor = pickColor(title);

      // Auto-detect language
      const sampleText = paragraphs.slice(0, 50).join(" ");
      const iso639_3 = franc(sampleText);
      const langMap: Record<string, string> = {
        deu: "de", eng: "en", spa: "es", fra: "fr", ita: "it", rus: "ru"
      };
      const detectedLang = langMap[iso639_3] || defaultLanguage || "de";

      const newBook: Book = {
        id: bookId,
        title,
        author: "Неизвестен",
        language: detectedLang,
        format: ext as "txt" | "epub",
        progress: 0,
        paragraphIndex: 0,
        chapterTitle: "Начало",
        lastReadAt: new Date().toLocaleDateString("ru"),
        coverColor,
        coverUrl: null,
        paragraphs,
      };

      // Save locally first for instant UI response
      saveLocalBook(newBook);
      onBooksChange([newBook, ...books]);

      // Sync to Supabase in background
      if (user) {
        const savedId = await sbUpsertBook({
          id: bookId,
          user_id: user.id,
          title,
          author: "Неизвестен",
          language: detectedLang,
          format: ext as "txt" | "epub",
          file_path: file.name,
          cover_url: null,
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при загрузке файла");
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDelete(id: string) {
    deleteLocalBook(id);
    onBooksChange(books.filter((b) => b.id !== id));
    if (user) await sbDeleteBook(id);
  }

  return (
    <section 
      className="screen"
      style={{ position: "relative", minHeight: "100vh" }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
    >
      {/* Context Menu Overlay */}
      {isMenuOpen && (
        <div 
          style={{ position: "fixed", inset: 0, zIndex: 40 }} 
          onClick={() => setIsMenuOpen(false)} 
        />
      )}

      <header className="screen-header">
        <div>
          <p className="eyebrow">Библиотека</p>
          <h1>Книги</h1>
        </div>
        <div style={{ position: "relative" }}>
          <button 
            className="icon-btn" 
            style={{ borderRadius: 99, background: "var(--accent)", color: "var(--text-dark)", border: "none" }}
            type="button" 
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            <Plus size={20} />
          </button>
          
          {isMenuOpen && (
            <div style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              width: 220,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-md)",
              padding: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              zIndex: 50
            }}>
              <button 
                className="action-card" 
                style={{ padding: "10px 12px", border: "none", gap: 12, borderRadius: "var(--radius-sm)", gridTemplateColumns: "auto 1fr" }}
                onClick={() => { setIsMenuOpen(false); fileRef.current?.click(); }}
              >
                <FileText size={18} style={{ color: "var(--accent)" }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>С компьютера</span>
              </button>
              <button 
                className="action-card" 
                style={{ padding: "10px 12px", border: "none", gap: 12, borderRadius: "var(--radius-sm)", gridTemplateColumns: "auto 1fr" }}
                onClick={() => { setIsMenuOpen(false); onNavigate("discover"); }}
              >
                <Globe size={18} style={{ color: "var(--green)" }} />
                <span style={{ fontSize: 14, fontWeight: 600 }}>Из каталога</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <input
        ref={fileRef}
        type="file"
        accept=".txt,.epub"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
      />



      {/* Drop zone overlay */}
      {isDragOver && (
        <div
          className="upload-zone drag-over"
          style={{ position: 'absolute', inset: 0, zIndex: 100, background: 'rgba(20, 18, 16, 0.95)', margin: 0, justifyContent: 'center' }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
        >
          <Upload size={48} style={{ marginBottom: 16 }} />
          <strong style={{ fontSize: 24 }}>Отпустите файл здесь</strong>
          <span style={{ fontSize: 16 }}>TXT или EPUB</span>
        </div>
      )}

      {/* Loading State for parsing */}
      {isLoading && (
        <div style={{ marginBottom: 20, padding: 20, textAlign: "center", background: "var(--bg-elevated)", borderRadius: 12 }}>
          <div className="shimmer-line" style={{ width: 40, height: 40, borderRadius: "50%", margin: "0 auto 12px" }} />
          <strong>Разбираем книгу…</strong>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>Это займёт несколько секунд</p>
        </div>
      )}

      {error && (
        <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 8, background: "rgba(196,106,106,0.15)", border: "1px solid rgba(196,106,106,0.3)", color: "#e08888", fontSize: 14 }}>
          {error}
        </div>
      )}

      {books.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={40} />
          <strong>Книг пока нет</strong>
          <p>Загрузите TXT или EPUB файл, чтобы начать читать и изучать язык</p>
        </div>
      ) : (
        <div className="book-list">
          {books.map((book) => (
            <div
              key={book.id}
              role="button"
              tabIndex={0}
              className={`book-card${book.id === activeBookId ? " active" : ""}`}
              onClick={() => onOpenBook(book)}
              onKeyDown={(e) => { if (e.key === "Enter") onOpenBook(book); }}
            >
              <span 
                className="book-cover" 
                style={book.coverUrl ? { backgroundImage: `url(${book.coverUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : { background: book.coverColor }}
              >
                {!book.coverUrl && book.language.toUpperCase()}
              </span>
              <span className="book-info">
                <span className="book-info-title">{book.title}</span>
                <span className="book-info-author">{book.author}</span>
                <span className="progress-bar">
                  <span className="progress-bar-fill" style={{ width: `${book.progress}%` }} />
                </span>
              </span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, flexShrink: 0 }}>
                <span className="book-pct">{Math.round(book.progress)}%</span>
                <button
                  type="button"
                  className="icon-btn"
                  style={{ width: 32, height: 32 }}
                  onClick={(e) => { e.stopPropagation(); void handleDelete(book.id); }}
                  aria-label="Удалить книгу"
                >
                  <Trash2 size={14} style={{ color: "var(--red)" }} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
