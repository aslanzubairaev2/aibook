"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/ui/AppShell";
import { HomeDashboard } from "@/components/home/HomeDashboard";
import { LibraryView } from "@/components/library/LibraryView";
import { ReaderView } from "@/components/reader/ReaderView";
import { CardsView } from "@/components/cards/CardsView";
import { SettingsView } from "@/components/settings/SettingsView";
import { getLocalBooks, getLocalCards, getLocalProfile, saveLocalCard, saveLocalProfile } from "@/lib/db/local";
import type { AppSection, Book, Flashcard, UserProfile } from "@/lib/types";

export default function Page() {
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

  // Load from localStorage after hydration
  useEffect(() => {
    setBooks(getLocalBooks());
    setCards(getLocalCards());
    setProfile(getLocalProfile());
    setIsHydrated(true);
  }, []);

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
    // If active book was deleted, clear it
    if (activeBook && !updated.find((b) => b.id === activeBook.id)) {
      setActiveBook(null);
      if (section === "reader") setSection("books");
    }
  }

  if (!isHydrated) return null; // Prevent SSR/hydration mismatch

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
