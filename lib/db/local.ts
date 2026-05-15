import type { Book, Flashcard, UserProfile } from "@/lib/types";

const BOOKS_KEY = "aibook_books";
const CARDS_KEY = "aibook_cards";
const PROFILE_KEY = "aibook_profile";
const PROGRESS_KEY = "aibook_progress";

// --- Books ---

export function getLocalBooks(): Book[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(BOOKS_KEY) ?? "[]") as Book[];
  } catch {
    return [];
  }
}

export function saveLocalBook(book: Book): void {
  const books = getLocalBooks();
  const idx = books.findIndex((b) => b.id === book.id);
  if (idx >= 0) books[idx] = book;
  else books.unshift(book);
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
}

/** Replace the entire books cache (used after Supabase sync) */
export function saveLocalBooks(books: Book[]): void {
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
}

export function deleteLocalBook(id: string): void {
  const books = getLocalBooks().filter((b) => b.id !== id);
  localStorage.setItem(BOOKS_KEY, JSON.stringify(books));
}

// --- Cards ---

export function getLocalCards(): Flashcard[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(CARDS_KEY) ?? "[]") as Flashcard[];
  } catch {
    return [];
  }
}

export function saveLocalCard(card: Flashcard): void {
  const cards = getLocalCards();
  cards.unshift(card);
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}

// --- Profile ---

const defaultProfile: UserProfile = {
  nativeLanguage: "ru",
  targetLanguage: "de",
  uiLanguage: "ru",
  readingMinutes: 0,
  booksStarted: 0,
  booksFinished: 0,
  savedItems: 0,
};

export function getLocalProfile(): UserProfile {
  if (typeof window === "undefined") return defaultProfile;
  try {
    const stored = localStorage.getItem(PROFILE_KEY);
    return stored ? (JSON.parse(stored) as UserProfile) : defaultProfile;
  } catch {
    return defaultProfile;
  }
}

export function saveLocalProfile(profile: UserProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

// --- Reading Progress (local cache) ---

interface ProgressEntry {
  bookId: string;
  paragraphIndex: number;
  updatedAt: string;
}

export function getLocalProgress(bookId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]") as ProgressEntry[];
    return all.find((e) => e.bookId === bookId)?.paragraphIndex ?? 0;
  } catch {
    return 0;
  }
}

export function saveLocalProgress(bookId: string, paragraphIndex: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]") as ProgressEntry[];
    const idx = all.findIndex((e) => e.bookId === bookId);
    const entry: ProgressEntry = { bookId, paragraphIndex, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // silently fail
  }
}
