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
  sbUpsertBook, sbUpsertChapter, sbUpsertLastView,
  type DbBook, type DbReadingProgress, type DbUserSettings,
} from "@/lib/db/supabase";
import { getLocalBooks, getLocalCards, getLocalLastView, getLocalProfile, saveLocalBook, saveLocalCard, saveLocalLastView, saveLocalProfile, saveLocalBooks, saveLocalReaderSelection, saveLocalProgressAnchor } from "@/lib/db/local";
import { parseBook } from "@/lib/parser/index";
import type { AppSection, Book, Flashcard, ReaderProgressSnapshot, UserProfile } from "@/lib/types";

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

const DOWNLOAD_START_MESSAGE = "\u041d\u0430\u0447\u0438\u043d\u0430\u0435\u043c \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0443";
const BOOK_TEXT_UNAVAILABLE_ERROR = "\u0422\u0435\u043a\u0441\u0442 \u043a\u043d\u0438\u0433\u0438 \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u0435\u043d";
const BOOK_TEXT_DOWNLOAD_ERROR = "\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0441\u043a\u0430\u0447\u0430\u0442\u044c \u0442\u0435\u043a\u0441\u0442 \u043a\u043d\u0438\u0433\u0438";
const DOWNLOADED_MESSAGE = "\u0417\u0430\u0433\u0440\u0443\u0436\u0435\u043d\u043e";
const DOWNLOADING_TEXT_MESSAGE = "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043c \u0442\u0435\u043a\u0441\u0442";
const PARSING_TEXT_MESSAGE = "\u0420\u0430\u0437\u0431\u0438\u0440\u0430\u0435\u043c \u0442\u0435\u043a\u0441\u0442";
const EMPTY_BOOK_ERROR = "\u0424\u0430\u0439\u043b \u043f\u0443\u0441\u0442\u043e\u0439 \u0438\u043b\u0438 \u043d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u0442\u044c \u0442\u0435\u043a\u0441\u0442";
const UNKNOWN_AUTHOR = "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u0435\u043d";
const START_CHAPTER = "\u041d\u0430\u0447\u0430\u043b\u043e";
const SAVING_TO_LIBRARY_MESSAGE = "\u0421\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u043c \u0432 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0443";
const BOOK_IN_LIBRARY_MESSAGE = "\u041a\u043d\u0438\u0433\u0430 \u0432 \u0431\u0438\u0431\u043b\u0438\u043e\u0442\u0435\u043a\u0435";
const DOWNLOAD_ERROR_MESSAGE = "\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438";
const DEFAULT_CHAPTER_TITLE = "\u0413\u043b\u0430\u0432\u0430 1";
const APP_SECTIONS: AppSection[] = ["home", "discover", "books", "reader", "cards", "settings"];

function pickColor(title: string) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

function isAppSection(value: string | null | undefined): value is AppSection {
  return Boolean(value && APP_SECTIONS.includes(value as AppSection));
}

function getLatestProgress(progress: DbReadingProgress[]): DbReadingProgress | null {
  return [...progress].sort((a, b) => {
    return new Date(b.last_read_at).getTime() - new Date(a.last_read_at).getTime();
  })[0] ?? null;
}

function dbProgressToSnapshot(progress: DbReadingProgress): ReaderProgressSnapshot {
  return {
    bookId: progress.book_id,
    paragraphIndex: progress.paragraph_index,
    charOffset: progress.char_offset ?? 0,
    percentage: Number(progress.percentage ?? 0),
    lastReadAt: progress.last_read_at,
    selectionState: progress.selection_state ?? null,
  };
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
  const [isRemoteSyncReady, setIsRemoteSyncReady] = useState(false);
  const [readerProgressByBook, setReaderProgressByBook] = useState<Record<string, ReaderProgressSnapshot>>({});
  const [downloadTasks, setDownloadTasks] = useState<Record<number, DownloadTask>>({});

  useEffect(() => {
    if (!isHydrated) return;
    saveLocalLastView(section, activeBook?.id ?? null);
    if (user && isRemoteSyncReady) {
      void sbUpsertLastView(user.id, section, activeBook?.id ?? null);
    }
  }, [section, activeBook?.id, isHydrated, isRemoteSyncReady, user]);

  // ─── Data loading ─────────────────────────────────────────────────────────
  function applySyncedLastView(settings: DbUserSettings | null, progress: DbReadingProgress[], availableBooks: Book[]) {
    const latestProgress = getLatestProgress(progress);
    const remoteSection = isAppSection(settings?.last_section) ? settings.last_section : null;
    const remoteBookId = settings?.last_book_id ?? latestProgress?.book_id ?? null;

    if (remoteSection === "reader") {
      const book = availableBooks.find((item) => item.id === remoteBookId) ??
        availableBooks.find((item) => item.id === latestProgress?.book_id);
      if (book) {
        setActiveBook(book);
        setSection("reader");
        saveLocalLastView("reader", book.id);
        return;
      }
      setSection("books");
      saveLocalLastView("books", null);
      return;
    }

    if (remoteSection) {
      const book = remoteBookId ? availableBooks.find((item) => item.id === remoteBookId) : null;
      if (book) setActiveBook(book);
      setSection(remoteSection);
      saveLocalLastView(remoteSection, book?.id ?? null);
      return;
    }

    if (latestProgress) {
      const book = availableBooks.find((item) => item.id === latestProgress.book_id);
      if (book) {
        setActiveBook(book);
        setSection("reader");
        saveLocalLastView("reader", book.id);
      }
    }
  }

  const loadData = useCallback(async (userId: string) => {
    setIsRemoteSyncReady(false);
    // Load from cache immediately for instant UI
    const localBooks = getLocalBooks();
    const lastView = getLocalLastView();
    setBooks(localBooks);
    setCards(getLocalCards());
    setProfile(getLocalProfile());
    if (lastView?.section === "reader" && lastView.bookId) {
      const lastBook = localBooks.find((book) => book.id === lastView.bookId);
      if (lastBook) {
        setActiveBook(lastBook);
        setSection("reader");
      }
    } else if (lastView?.section && ["home", "discover", "books", "cards", "settings"].includes(lastView.section)) {
      setSection(lastView.section as AppSection);
    }
    setIsHydrated(true);

    // Then fetch fresh data from Supabase in background
    const [dbBooks, dbCards, dbSettings, dbProgress] = await Promise.all([
      sbGetBooks(userId),
      sbGetFlashcards(userId),
      sbGetSettings(userId),
      sbGetProgress(userId),
    ]);
    setReaderProgressByBook(Object.fromEntries(dbProgress.map((progress) => [
      progress.book_id,
      dbProgressToSnapshot(progress),
    ])));

    // Build Book objects from Supabase data
    if (dbBooks.length > 0) {
      const progressMap = new Map(dbProgress.map((p) => [p.book_id, p]));
      dbProgress.forEach((progress) => {
        saveLocalProgressAnchor(progress.book_id, progress.paragraph_index, progress.char_offset ?? 0);
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
      applySyncedLastView(dbSettings, dbProgress, fullBooks);
    } else {
      applySyncedLastView(dbSettings, dbProgress, localBooks);
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
    setIsRemoteSyncReady(true);
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
      const lastView = getLocalLastView();
      if (lastView?.section === "reader" && lastView.bookId) {
        const lastBook = getLocalBooks().find((book) => book.id === lastView.bookId);
        if (lastBook) {
          setActiveBook(lastBook);
          setSection("reader");
        }
      }
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

  function handleReaderProgressSync(progress: ReaderProgressSnapshot) {
    setReaderProgressByBook((prev) => ({ ...prev, [progress.bookId]: progress }));
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
      message: DOWNLOAD_START_MESSAGE,
    });

    try {
      const textKey = Object.keys(bookInfo.formats).find((key) => key.startsWith("text/plain"));
      if (!textKey) throw new Error(BOOK_TEXT_UNAVAILABLE_ERROR);

      const textUrl = bookInfo.formats[textKey].replace("http://", "https://");
      const res = await fetch(`/api/books/proxy?url=${encodeURIComponent(textUrl)}`);
      if (!res.ok) throw new Error(BOOK_TEXT_DOWNLOAD_ERROR);

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
              message: total > 0 ? `${DOWNLOADED_MESSAGE} ${Math.min(100, Math.round((received / total) * 100))}%` : DOWNLOADING_TEXT_MESSAGE,
            });
          }
        }
      } else {
        chunks.push(new Uint8Array(await res.arrayBuffer()));
      }

      setDownloadTask(bookInfo.id, { progress: 72, status: "parsing", message: PARSING_TEXT_MESSAGE });
      const blob = new Blob(chunks.map((chunk) => chunk.slice().buffer), { type: "text/plain" });
      const file = new File([blob], `${bookInfo.title}.txt`, { type: "text/plain" });
      const paragraphs = await parseBook(file);
      if (paragraphs.length === 0) throw new Error(EMPTY_BOOK_ERROR);

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
      const author = bookInfo.authors?.[0]?.name || UNKNOWN_AUTHOR;
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
        chapterTitle: START_CHAPTER,
        lastReadAt: new Date().toLocaleDateString("ru"),
        coverColor,
        coverUrl,
        paragraphs,
      };

      setDownloadTask(bookInfo.id, { progress: 88, status: "saving", message: SAVING_TO_LIBRARY_MESSAGE });
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
            title: START_CHAPTER,
            paragraphs,
            plain_text: paragraphs.join("\n"),
            char_count: paragraphs.join("").length,
          });
        }
      }

      setDownloadTask(bookInfo.id, {
        progress: 100,
        status: "done",
        message: BOOK_IN_LIBRARY_MESSAGE,
        bookLocalId: newBook.id,
      });
    } catch (err) {
      setDownloadTask(bookInfo.id, {
        progress: 0,
        status: "error",
        message: err instanceof Error ? err.message : DOWNLOAD_ERROR_MESSAGE,
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
          initialProgress={readerProgressByBook[lastBook.id] ?? null}
          onReaderProgressSync={handleReaderProgressSync}
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
    author: db.author ?? UNKNOWN_AUTHOR,
    language: db.language,
    format: db.format,
    progress: Number(progress),
    paragraphIndex,
    chapterTitle: DEFAULT_CHAPTER_TITLE,
    lastReadAt: new Date(db.created_at).toLocaleDateString("ru"),
    coverColor: db.cover_color,
    coverUrl: db.cover_url,
    paragraphs,
  };
}
