"use client";

import { useRef, useState } from "react";
import { BookOpen, Trash2, Upload } from "lucide-react";
import { parseBook } from "@/lib/parser/index";
import { saveLocalBook, deleteLocalBook } from "@/lib/db/local";
import { BOOK_FORMATS, SUPPORTED_LANGUAGES } from "@/lib/config";
import type { Book } from "@/lib/types";

type Props = {
  books: Book[];
  activeBookId: string | null;
  onBooksChange: (books: Book[]) => void;
  onOpenBook: (book: Book) => void;
};

const COVER_COLORS = [
  "linear-gradient(135deg, #d4a847, #a07c2e)",
  "linear-gradient(135deg, #7aab6a, #4a7040)",
  "linear-gradient(135deg, #6a98c4, #3a5880)",
  "linear-gradient(135deg, #c46a6a, #8a3a3a)",
  "linear-gradient(135deg, #9b7ab0, #5a3a70)",
  "linear-gradient(135deg, #c4956a, #8a5a30)",
];

function pickColor(title: string) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

export function LibraryView({ books, activeBookId, onBooksChange, onOpenBook }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
      const newBook: Book = {
        id: `book-${Date.now()}`,
        title,
        author: "Неизвестен",
        language: "de",
        format: (ext as "txt" | "epub"),
        progress: 0,
        paragraphIndex: 0,
        chapterTitle: "Начало",
        lastReadAt: new Date().toLocaleDateString("ru"),
        coverColor: pickColor(title),
        paragraphs,
      };
      saveLocalBook(newBook);
      onBooksChange([newBook, ...books]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка при загрузке файла");
    } finally {
      setIsLoading(false);
    }
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation();
    deleteLocalBook(id);
    onBooksChange(books.filter((b) => b.id !== id));
  }

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Библиотека</p>
          <h1>Книги</h1>
        </div>
        <button className="pill-btn" type="button" onClick={() => fileRef.current?.click()}>
          <Upload size={16} />
          Загрузить
        </button>
      </header>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.epub"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }}
      />

      {/* Dropzone */}
      <div
        className={`upload-zone${isDragOver ? " drag-over" : ""}`}
        style={{ marginBottom: 20 }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) void handleFile(f);
        }}
      >
        {isLoading ? (
          <>
            <div className="shimmer-line" style={{ width: 40, height: 40, borderRadius: "50%" }} />
            <strong>Разбираем книгу…</strong>
            <span>Это займёт несколько секунд</span>
          </>
        ) : (
          <>
            <Upload size={32} />
            <strong>Перетащите файл сюда</strong>
            <span>или нажмите для выбора · TXT, EPUB</span>
          </>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: 16, padding: "12px 14px", borderRadius: 8, background: "rgba(196, 106, 106, 0.15)", border: "1px solid rgba(196,106,106,0.3)", color: "#c46a6a", fontSize: 14 }}>
          {error}
        </div>
      )}

      {/* Book list */}
      {books.length === 0 ? (
        <div className="empty-state">
          <BookOpen size={40} />
          <strong>Книг пока нет</strong>
          <p>Загрузите TXT или EPUB файл, чтобы начать читать и изучать язык</p>
        </div>
      ) : (
        <div className="book-list">
          {books.map((book) => (
            <button
              key={book.id}
              type="button"
              className={`book-card${book.id === activeBookId ? " active" : ""}`}
              onClick={() => onOpenBook(book)}
            >
              <span className="book-cover" style={{ background: book.coverColor }}>
                {book.language.toUpperCase()}
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
                  onClick={(e) => handleDelete(e, book.id)}
                  aria-label="Удалить книгу"
                >
                  <Trash2 size={15} style={{ color: "var(--red)" }} />
                </button>
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
