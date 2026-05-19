import type { AiAnalysis, Book, DiscussMessage, Flashcard, ReaderSelectionSnapshot, UserProfile } from "@/lib/types";

const BOOKS_KEY = "aibook_books";
const CARDS_KEY = "aibook_cards";
const PROFILE_KEY = "aibook_profile";
const PROGRESS_KEY = "aibook_progress";
const AI_CACHE_KEY = "aibook_ai_selection_cache";
const DISCUSS_CACHE_KEY = "aibook_discuss_cache";
const READER_SELECTION_KEY = "aibook_reader_selection";

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
  ttsProvider: "local",
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
  charOffset?: number;
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

export function getLocalProgressAnchor(bookId: string): { paragraphIndex: number; charOffset: number } {
  if (typeof window === "undefined") return { paragraphIndex: 0, charOffset: 0 };
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]") as ProgressEntry[];
    const entry = all.find((e) => e.bookId === bookId);
    return {
      paragraphIndex: entry?.paragraphIndex ?? 0,
      charOffset: entry?.charOffset ?? 0,
    };
  } catch {
    return { paragraphIndex: 0, charOffset: 0 };
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

export function saveLocalProgressAnchor(bookId: string, paragraphIndex: number, charOffset = 0): void {
  try {
    const all = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "[]") as ProgressEntry[];
    const idx = all.findIndex((e) => e.bookId === bookId);
    const entry: ProgressEntry = { bookId, paragraphIndex, charOffset, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    // silently fail
  }
}

type SelectionEntry = {
  bookId: string;
  selection: ReaderSelectionSnapshot;
};

export function getLocalReaderSelection(bookId: string): ReaderSelectionSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem(READER_SELECTION_KEY) ?? "[]") as SelectionEntry[];
    return all.find((entry) => entry.bookId === bookId)?.selection ?? null;
  } catch {
    return null;
  }
}

export function saveLocalReaderSelection(bookId: string, selection: ReaderSelectionSnapshot): void {
  try {
    const all = JSON.parse(localStorage.getItem(READER_SELECTION_KEY) ?? "[]") as SelectionEntry[];
    const idx = all.findIndex((entry) => entry.bookId === bookId);
    const entry: SelectionEntry = { bookId, selection };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(READER_SELECTION_KEY, JSON.stringify(all));
  } catch {
    // silently fail
  }
}

type AiCacheEntry = {
  key: string;
  value: AiAnalysis;
  updatedAt: string;
};

export function getLocalAiAnalysis(key: string): AiAnalysis | null {
  if (typeof window === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? "[]") as AiCacheEntry[];
    return all.find((entry) => entry.key === key)?.value ?? null;
  } catch {
    return null;
  }
}

export function saveLocalAiAnalysis(key: string, value: AiAnalysis): void {
  try {
    const all = JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? "[]") as AiCacheEntry[];
    const idx = all.findIndex((entry) => entry.key === key);
    const entry: AiCacheEntry = { key, value, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(all.slice(-250)));
  } catch {
    // silently fail
  }
}

type DiscussCacheEntry = {
  key: string;
  messages: DiscussMessage[];
  updatedAt: string;
};

export function getLocalDiscussHistory(key: string): DiscussMessage[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(DISCUSS_CACHE_KEY) ?? "[]") as DiscussCacheEntry[];
    return all.find((entry) => entry.key === key)?.messages ?? [];
  } catch {
    return [];
  }
}

export function saveLocalDiscussHistory(key: string, messages: DiscussMessage[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(DISCUSS_CACHE_KEY) ?? "[]") as DiscussCacheEntry[];
    const idx = all.findIndex((entry) => entry.key === key);
    const entry: DiscussCacheEntry = { key, messages, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(DISCUSS_CACHE_KEY, JSON.stringify(all.slice(-120)));
  } catch {
    // silently fail
  }
}
