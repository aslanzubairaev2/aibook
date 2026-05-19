"use client";

import { useCallback, useEffect, useState } from "react";
import { franc } from "franc-min";
import { AppShell } from "@/components/ui/AppShell";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { LibraryView } from "@/components/library/LibraryView";
import { DiscoverView } from "@/components/discover/DiscoverView";
import { ReaderView } from "@/components/reader/ReaderView";
import { CardsView } from "@/components/cards/CardsView";
import { SettingsView } from "@/components/settings/SettingsView";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { AuthProvider, useAuth } from "@/lib/auth/useAuth";
import {
  sbGetBooks, sbGetChapters, sbGetFlashcards, sbGetSettings, sbGetProgress,
  sbUpsertBook, sbUpsertChapter,
  type DbBook,
} from "@/lib/db/supabase";
import { getLocalBooks, getLocalCards, getLocalProfile, saveLocalBook, saveLocalCard, saveLocalProfile, saveLocalBooks, saveLocalReaderSelection } from "@/lib/db/local";
import { parseBook } from "@/lib/parser/index";
import type { AppSection, Book, Flashcard, UserProfile } from "@/lib/types";

// ─── Inner app (needs auth context) ─────────────────────────────────────────

type CatalogBook = {
  id: number;
  title: string;
  authors: { name: string }[];
  languages: string[];
  formats: Record<string, string>;
};

type DownloadTask = {
  bookId: number;
  title: string;
  progress: number;
  status: "downloading" | "parsing" | "saving" | "done" | "error";
  message: string;
  bookLocalId?: string;
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

function AppInner() {
  const { user, isLoading: authLoading } = useAuth();
  const [section, setSection] = useState<AppSection>("home");
  const [books, setBooks] = useState<Book[]>([]);
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [profile, setProfile] = useState<UserProfile>({
    nativeLanguage: "ru",
    targetLanguage: "de",
    uiLanguage: "ru",
    readingMinutes: 0,
    booksStarted: 0,
    booksFinished: 0,
    savedItems: 0,
  });
  const [activeBook, setActiveBook] = useState<Book | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [downloadTasks, setDownloadTasks] = useState<Record<number, DownloadTask>>({});

  // ─── Data loading ─────────────────────────────────────────────────────────
  const loadData = useCallback(async (userId: string) => {
    // Load from cache immediately for instant UI
    setBooks(getLocalBooks());
    setCards(getLocalCards());
    setProfile(getLocalProfile());
    setIsHydrated(true);

    // Then fetch fresh data from Supabase in background
    const [dbBooks, dbCards, dbSettings, dbProgress] = await Promise.all([
      sbGetBooks(userId),
      sbGetFlashcards(userId),
      sbGetSettings(userId),
      sbGetProgress(userId),
    ]);

    // Build Book objects from Supabase data
    if (dbBooks.length > 0) {
      const progressMap = new Map(dbProgress.map((p) => [p.book_id, p]));
      dbProgress.forEach((progress) => {
        if (progress.selection_state) saveLocalReaderSelection(progress.book_id, progress.selection_state);
      });
      const fullBooks: Book[] = await Promise.all(
        dbBooks.map(async (db) => {
          const prog = progressMap.get(db.id);
          const chapters = await sbGetChapters(db.id);
          const paragraphs = chapters.flatMap((c) => c.paragraphs);
          return dbBookToBook(db, paragraphs, prog?.paragraph_index ?? 0, prog?.percentage ?? 0);
        })
      );
      setBooks(fullBooks);
      saveLocalBooks(fullBooks);
    }

    // Flashcards
    if (dbCards.length > 0) {
      const localCards: Flashcard[] = dbCards.map((c) => ({
        id: c.id,
        type: c.selection_type,
        front: c.front,
        back: c.back,
        source: c.source_book_title ?? "",
        addedAt: c.created_at,
        status: "new" as const,
      }));
      setCards(localCards);
    }

    // Profile/settings
    if (dbSettings) {
      const updated: UserProfile = {
        ...getLocalProfile(),
        nativeLanguage: dbSettings.native_language,
        targetLanguage: dbSettings.active_target_lang,
        uiLanguage: dbSettings.ui_language,
        ttsProvider: (dbSettings.tts_provider as "local" | "gemini") ?? "local",
        readingMinutes: dbSettings.reading_minutes ?? 0,
        booksStarted: dbSettings.books_started ?? 0,
        booksFinished: dbSettings.books_finished ?? 0,
        savedItems: dbCards.length,
      };
      setProfile(updated);
      saveLocalProfile(updated);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (user) {
      void loadData(user.id);
    } else {
      // Not logged in → show cached data or empty state
      setBooks(getLocalBooks());
      setCards(getLocalCards());
      setProfile(getLocalProfile());
      setIsHydrated(true);
    }
  }, [user, authLoading, loadData]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  function handleOpenBook(book: Book) {
    setActiveBook(book);
    setSection("reader");
  }

  function handleAddCard(card: Flashcard) {
    saveLocalCard(card);
    setCards((prev) => [card, ...prev]);
    const updatedProfile = { ...profile, savedItems: profile.savedItems + 1 };
    saveLocalProfile(updatedProfile);
    setProfile(updatedProfile);
  }

  function handleProfileChange(updated: UserProfile) {
    setProfile(updated);
  }

  function handleProgressUpdate(updated: Book) {
    setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
    if (activeBook?.id === updated.id) setActiveBook(updated);
  }

  function handleBooksChange(updated: Book[]) {
    setBooks(updated);
    if (activeBook && !updated.find((b) => b.id === activeBook.id)) {
      setActiveBook(null);
      if (section === "reader") setSection("books");
    }
  }

  function setDownloadTask(bookId: number, patch: Partial<DownloadTask>) {
    setDownloadTasks((prev) => ({
      ...prev,
      [bookId]: {
        bookId,
        title: patch.title ?? prev[bookId]?.title ?? "",
        progress: patch.progress ?? prev[bookId]?.progress ?? 0,
        status: patch.status ?? prev[bookId]?.status ?? "downloading",
        message: patch.message ?? prev[bookId]?.message ?? "",
        bookLocalId: patch.bookLocalId ?? prev[bookId]?.bookLocalId,
      },
    }));
  }

  async function handleCatalogDownload(bookInfo: CatalogBook) {
    const existing = books.find((item) => item.title.toLowerCase() === bookInfo.title.toLowerCase());
    if (existing) {
      handleOpenBook(existing);
      return;
    }

    const existingTask = downloadTasks[bookInfo.id];
    if (existingTask?.status === "downloading" || existingTask?.status === "parsing" || existingTask?.status === "saving") return;

    setDownloadTask(bookInfo.id, {
      title: bookInfo.title,
      progress: 2,
      status: "downloading",
      message: "Начинаем загрузку",
    });

    try {
      const textKey = Object.keys(bookInfo.formats).find((key) => key.startsWith("text/plain"));
      if (!textKey) throw new Error("Текст книги недоступен");

      const textUrl = bookInfo.formats[textKey].replace("http://", "https://");
      const res = await fetch(`/api/books/proxy?url=${encodeURIComponent(textUrl)}`);
      if (!res.ok) throw new Error("Не удалось скачать текст книги");

      const total = Number(res.headers.get("content-length") ?? 0);
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            const progress = total > 0 ? Math.round((received / total) * 68) : Math.min(68, 12 + Math.round(received / 50000));
            setDownloadTask(bookInfo.id, {
              progress,
              status: "downloading",
              message: total > 0 ? `Загружено ${Math.min(100, Math.round((received / total) * 100))}%` : "Загружаем текст",
            });
          }
        }
      } else {
        chunks.push(new Uint8Array(await res.arrayBuffer()));
      }

      setDownloadTask(bookInfo.id, { progress: 72, status: "parsing", message: "Разбираем текст" });
      const blob = new Blob(chunks.map((chunk) => chunk.slice().buffer), { type: "text/plain" });
      const file = new File([blob], `${bookInfo.title}.txt`, { type: "text/plain" });
      const paragraphs = await parseBook(file);
      if (paragraphs.length === 0) throw new Error("Файл пустой или не удалось разобрать текст");

      const langMap: Record<string, string> = {
        deu: "de",
        eng: "en",
        spa: "es",
        fra: "fr",
        ita: "it",
        rus: "ru",
      };
      const detectedLang = langMap[franc(paragraphs.slice(0, 50).join(" "))] || bookInfo.languages?.[0] || "en";
      const bookId = crypto.randomUUID();
      const author = bookInfo.authors?.[0]?.name || "Неизвестен";
      const coverKey = Object.keys(bookInfo.formats).find((key) => key.startsWith("image/jpeg"));
      const coverUrl = coverKey ? bookInfo.formats[coverKey].replace("http://", "https://") : null;
      const coverColor = pickColor(bookInfo.title);

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

      setDownloadTask(bookInfo.id, { progress: 88, status: "saving", message: "Сохраняем в библиотеку" });
      saveLocalBook(newBook);
      setBooks((prev) => [newBook, ...prev]);

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

      setDownloadTask(bookInfo.id, {
        progress: 100,
        status: "done",
        message: "Книга в библиотеке",
        bookLocalId: newBook.id,
      });
    } catch (err) {
      setDownloadTask(bookInfo.id, {
        progress: 0,
        status: "error",
        message: err instanceof Error ? err.message : "Ошибка загрузки",
      });
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (authLoading || !isHydrated) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100svh" }}>
        <div className="auth-spinner-wrap">
          <div className="auth-spinner-ring" />
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  const lastBook = activeBook ?? books[0] ?? null;

  return (
    <AppShell activeSection={section} onSectionChange={setSection}>
      {section === "home" && (
        <HomeDashboard
          book={lastBook}
          books={books}
          profile={profile}
          cards={cards}
          onBooksChange={handleBooksChange}
          onOpenBook={handleOpenBook}
          downloadTasks={downloadTasks}
          onDownloadBook={(book) => void handleCatalogDownload(book)}
          onContinueReading={() => {
            if (lastBook) { setActiveBook(lastBook); setSection("reader"); }
            else setSection("books");
          }}
          onOpenCards={() => setSection("cards")}
          onOpenBooks={() => setSection("books")}
          onOpenDiscover={() => setSection("discover")}
        />
      )}

      {section === "books" && (
        <LibraryView
          books={books}
          activeBookId={activeBook?.id ?? null}
          onBooksChange={handleBooksChange}
          onOpenBook={handleOpenBook}
          onNavigate={setSection}
          defaultLanguage={profile.targetLanguage}
        />
      )}

      {section === "discover" && (
        <DiscoverView
          books={books}
          onBooksChange={handleBooksChange}
          onOpenBook={handleOpenBook}
          downloadTasks={downloadTasks}
          onDownloadBook={(book) => void handleCatalogDownload(book)}
        />
      )}

      {section === "reader" && lastBook ? (
        <ReaderView
          book={lastBook}
          profile={profile}
          onBack={() => setSection("home")}
          onAddCard={handleAddCard}
          onProgressUpdate={handleProgressUpdate}
          onProfileChange={handleProfileChange}
        />
      ) : section === "reader" ? (
        <>{setSection("books")}</>
      ) : null}

      {section === "cards" && (
        <CardsView
          cards={cards}
          onBack={() => setSection("home")}
        />
      )}

      {section === "settings" && (
        <SettingsView
          profile={profile}
          onProfileChange={handleProfileChange}
        />
      )}
    </AppShell>
  );
}

// ─── Root export ─────────────────────────────────────────────────────────────

export default function Page() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dbBookToBook(db: DbBook, paragraphs: string[], paragraphIndex: number, progress: number): Book {
  return {
    id: db.id,
    title: db.title,
    author: db.author ?? "Неизвестен",
    language: db.language,
    format: db.format,
    progress: Number(progress),
    paragraphIndex,
    chapterTitle: "Глава 1",
    lastReadAt: new Date(db.created_at).toLocaleDateString("ru"),
    coverColor: db.cover_color,
    coverUrl: db.cover_url,
    paragraphs,
  };
}
