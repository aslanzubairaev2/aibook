"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/ui/AppShell";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { LibraryView } from "@/components/library/LibraryView";
import { ReaderView } from "@/components/reader/ReaderView";
import { CardsView } from "@/components/cards/CardsView";
import { SettingsView } from "@/components/settings/SettingsView";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { AuthProvider, useAuth } from "@/lib/auth/useAuth";
import {
  sbGetBooks, sbGetChapters, sbGetFlashcards, sbGetSettings, sbGetProgress,
  type DbBook,
} from "@/lib/db/supabase";
import { getLocalBooks, getLocalCards, getLocalProfile, saveLocalCard, saveLocalProfile, saveLocalBooks } from "@/lib/db/local";
import type { AppSection, Book, Flashcard, UserProfile } from "@/lib/types";

// ─── Inner app (needs auth context) ─────────────────────────────────────────

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
          profile={profile}
          cards={cards}
          onContinueReading={() => {
            if (lastBook) { setActiveBook(lastBook); setSection("reader"); }
            else setSection("books");
          }}
          onOpenCards={() => setSection("cards")}
          onOpenBooks={() => setSection("books")}
        />
      )}

      {section === "books" && (
        <LibraryView
          books={books}
          activeBookId={activeBook?.id ?? null}
          onBooksChange={handleBooksChange}
          onOpenBook={handleOpenBook}
        />
      )}

      {section === "reader" && lastBook ? (
        <ReaderView
          book={lastBook}
          profile={profile}
          onBack={() => setSection("home")}
          onAddCard={handleAddCard}
          onProgressUpdate={handleProgressUpdate}
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
    paragraphs,
  };
}
