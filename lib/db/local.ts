import type { AiAnalysis, Book, CardSkillState, DiscussMessage, Flashcard, GrammarTable, ProductiveSkill, ReaderSelectionSnapshot, SkillProgress, UserProfile } from "@/lib/types";

const BOOKS_KEY = "aibook_books";
const CARDS_KEY = "aibook_cards";
const PROFILE_KEY = "aibook_profile";
const PROGRESS_KEY = "aibook_progress";
const AI_CACHE_KEY = "aibook_ai_selection_cache";
const GRAMMAR_CACHE_KEY = "aibook_grammar_cache";
const SKILL_PROGRESS_KEY = "aibook_skill_progress";
const DISCUSS_CACHE_KEY = "aibook_discuss_cache";
const READER_SELECTION_KEY = "aibook_reader_selection";
const LAST_VIEW_KEY = "aibook_last_view";

let activeNamespace = "guest";

export function setLocalNamespace(ns: string) {
  activeNamespace = ns;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("aibook_active_namespace", ns);
    } catch {
      // ignore
    }
  }
}

export function getLocalNamespace(): string {
  if (typeof window !== "undefined") {
    try {
      return localStorage.getItem("aibook_active_namespace") ?? activeNamespace;
    } catch {
      return activeNamespace;
    }
  }
  return activeNamespace;
}

function getNsKey(baseKey: string): string {
  const ns = getLocalNamespace();
  const nsKey = `ns:${ns}:${baseKey}`;
  
  if (typeof window !== "undefined" && ns === "guest") {
    try {
      // If namespaced key doesn't exist but legacy key does, migrate/copy it
      if (localStorage.getItem(nsKey) === null && localStorage.getItem(baseKey) !== null) {
        const val = localStorage.getItem(baseKey);
        if (val !== null) {
          localStorage.setItem(nsKey, val);
        }
      }
    } catch {
      // ignore
    }
  }
  return nsKey;
}

// --- Simple self-contained IndexedDB utility ---
const DB_NAME = "aibook_indexeddb";
const STORE_NAME = "books_store";
const DB_VERSION = 1;

function getIDBStore(): Promise<IDBObjectStore | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      resolve(null);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      try {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        resolve(transaction.objectStore(STORE_NAME));
      } catch {
        resolve(null);
      }
    };
    request.onerror = () => {
      resolve(null);
    };
  });
}

function getIDBValue(key: string): Promise<any> {
  return new Promise(async (resolve) => {
    try {
      const store = await getIDBStore();
      if (!store) {
        resolve(null);
        return;
      }
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function setIDBValue(key: string, value: any): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const store = await getIDBStore();
      if (!store) {
        resolve(); // no-op on SSR
        return;
      }
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    } catch (err) {
      reject(err);
    }
  });
}

// --- Books ---

export async function getLocalBooks(): Promise<Book[]> {
  if (typeof window === "undefined") return [];
  const nsKey = getNsKey(BOOKS_KEY);
  try {
    // 1. Try to read from IndexedDB
    const val = await getIDBValue(nsKey);
    if (val) return val as Book[];

    // 2. If not in IndexedDB, check namespaced localStorage key (migration)
    const localVal = localStorage.getItem(nsKey);
    if (localVal) {
      const books = JSON.parse(localVal) as Book[];
      // Save it to IndexedDB
      await setIDBValue(nsKey, books);
      // Clean up localStorage to instantly free up the quota!
      try {
        localStorage.removeItem(nsKey);
      } catch {
        // ignore
      }
      return books;
    }
    
    // Also try migrating from the legacy base key if guest
    const baseVal = localStorage.getItem(BOOKS_KEY);
    if (baseVal) {
      const books = JSON.parse(baseVal) as Book[];
      await setIDBValue(nsKey, books);
      // Clean up legacy base key to free up quota
      try {
        localStorage.removeItem(BOOKS_KEY);
      } catch {
        // ignore
      }
      return books;
    }
    
    return [];
  } catch {
    return [];
  }
}

export async function saveLocalBook(book: Book): Promise<void> {
  const books = await getLocalBooks();
  const idx = books.findIndex((b) => b.id === book.id);
  if (idx >= 0) books[idx] = book;
  else books.unshift(book);
  await saveLocalBooks(books);
}

/** Replace the entire books cache (used after Supabase sync) */
export async function saveLocalBooks(books: Book[]): Promise<void> {
  const nsKey = getNsKey(BOOKS_KEY);
  await setIDBValue(nsKey, books);
  // Also proactively clean up the localStorage counterparts to prevent quota exceed errors in future
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(nsKey);
      localStorage.removeItem(BOOKS_KEY);
    } catch {
      // ignore
    }
  }
}

export async function deleteLocalBook(id: string): Promise<void> {
  const books = (await getLocalBooks()).filter((b) => b.id !== id);
  await saveLocalBooks(books);
}

// --- Cards ---

export function getLocalCards(): Flashcard[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(getNsKey(CARDS_KEY)) ?? "[]") as Flashcard[];
  } catch {
    return [];
  }
}

export function saveLocalCard(card: Flashcard): void {
  const cards = getLocalCards();
  const idx = cards.findIndex((c) => c.id === card.id);
  if (idx >= 0) cards[idx] = card;
  else cards.unshift(card);
  localStorage.setItem(getNsKey(CARDS_KEY), JSON.stringify(cards));
}

export function saveLocalCards(cards: Flashcard[]): void {
  localStorage.setItem(getNsKey(CARDS_KEY), JSON.stringify(cards));
}

export function deleteLocalCard(id: string): void {
  const cards = getLocalCards().filter((c) => c.id !== id);
  localStorage.setItem(getNsKey(CARDS_KEY), JSON.stringify(cards));
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
    const stored = localStorage.getItem(getNsKey(PROFILE_KEY));
    return stored ? (JSON.parse(stored) as UserProfile) : defaultProfile;
  } catch {
    return defaultProfile;
  }
}

export function saveLocalProfile(profile: UserProfile): void {
  localStorage.setItem(getNsKey(PROFILE_KEY), JSON.stringify(profile));
}

// --- Gemini API Key ---

const GEMINI_KEY_KEY = "aibook_custom_gemini_key";

export function getLocalGeminiKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(getNsKey(GEMINI_KEY_KEY)) ?? "";
  } catch {
    return "";
  }
}

export function saveLocalGeminiKey(key: string): void {
  try {
    localStorage.setItem(getNsKey(GEMINI_KEY_KEY), key);
  } catch {
    // silently fail
  }
}

// --- AI Provider ---

const AI_PROVIDER_KEY = "aibook_ai_provider";

export function getLocalAiProvider(): "off" | "custom" {
  if (typeof window === "undefined") return "custom"; // default to custom so if they have key it works
  try {
    return (localStorage.getItem(getNsKey(AI_PROVIDER_KEY)) as "off" | "custom") ?? "custom";
  } catch {
    return "custom";
  }
}

export function saveLocalAiProvider(provider: "off" | "custom"): void {
  try {
    localStorage.setItem(getNsKey(AI_PROVIDER_KEY), provider);
  } catch {
    // silently fail
  }
}

// --- Reading Progress (local cache) ---

interface ProgressEntry {
  bookId: string;
  paragraphIndex: number;
  charOffset?: number;
  updatedAt: string;
}

export type LocalLastView = {
  section: string;
  bookId?: string | null;
  updatedAt?: string;
};

export function getLocalProgress(bookId: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(PROGRESS_KEY)) ?? "[]") as ProgressEntry[];
    return all.find((e) => e.bookId === bookId)?.paragraphIndex ?? 0;
  } catch {
    return 0;
  }
}

export function getLocalProgressAnchor(bookId: string): { paragraphIndex: number; charOffset: number } {
  if (typeof window === "undefined") return { paragraphIndex: 0, charOffset: 0 };
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(PROGRESS_KEY)) ?? "[]") as ProgressEntry[];
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
    const all = JSON.parse(localStorage.getItem(getNsKey(PROGRESS_KEY)) ?? "[]") as ProgressEntry[];
    const idx = all.findIndex((e) => e.bookId === bookId);
    const entry: ProgressEntry = { bookId, paragraphIndex, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(getNsKey(PROGRESS_KEY), JSON.stringify(all));
  } catch {
    // silently fail
  }
}

export function saveLocalProgressAnchor(bookId: string, paragraphIndex: number, charOffset = 0): void {
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(PROGRESS_KEY)) ?? "[]") as ProgressEntry[];
    const idx = all.findIndex((e) => e.bookId === bookId);
    const entry: ProgressEntry = { bookId, paragraphIndex, charOffset, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(getNsKey(PROGRESS_KEY), JSON.stringify(all));
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
    const all = JSON.parse(localStorage.getItem(getNsKey(READER_SELECTION_KEY)) ?? "[]") as SelectionEntry[];
    return all.find((entry) => entry.bookId === bookId)?.selection ?? null;
  } catch {
    return null;
  }
}

export function saveLocalReaderSelection(bookId: string, selection: ReaderSelectionSnapshot): void {
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(READER_SELECTION_KEY)) ?? "[]") as SelectionEntry[];
    const idx = all.findIndex((entry) => entry.bookId === bookId);
    const entry: SelectionEntry = { bookId, selection };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(getNsKey(READER_SELECTION_KEY), JSON.stringify(all));
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
    const all = JSON.parse(localStorage.getItem(getNsKey(AI_CACHE_KEY)) ?? "[]") as AiCacheEntry[];
    return all.find((entry) => entry.key === key)?.value ?? null;
  } catch {
    return null;
  }
}

export function saveLocalAiAnalysis(key: string, value: AiAnalysis): void {
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(AI_CACHE_KEY)) ?? "[]") as AiCacheEntry[];
    const idx = all.findIndex((entry) => entry.key === key);
    const entry: AiCacheEntry = { key, value, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(getNsKey(AI_CACHE_KEY), JSON.stringify(all.slice(-250)));
  } catch {
    // silently fail
  }
}

type GrammarCacheEntry = {
  key: string;
  value: GrammarTable;
  updatedAt: string;
};

export function getLocalGrammar(key: string): GrammarTable | null {
  if (typeof window === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(GRAMMAR_CACHE_KEY)) ?? "[]") as GrammarCacheEntry[];
    return all.find((entry) => entry.key === key)?.value ?? null;
  } catch {
    return null;
  }
}

export function saveLocalGrammar(key: string, value: GrammarTable): void {
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(GRAMMAR_CACHE_KEY)) ?? "[]") as GrammarCacheEntry[];
    const idx = all.findIndex((entry) => entry.key === key);
    const entry: GrammarCacheEntry = { key, value, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(getNsKey(GRAMMAR_CACHE_KEY), JSON.stringify(all.slice(-150)));
  } catch {
    // silently fail
  }
}

// Productive-recall progress, keyed by card id → per-skill SRS state.
// Stored locally only (the remote flashcards table has no columns for it).
type SkillProgressMap = Record<string, CardSkillState>;

function readSkillProgressMap(): SkillProgressMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(getNsKey(SKILL_PROGRESS_KEY)) ?? "{}") as SkillProgressMap;
  } catch {
    return {};
  }
}

export function getCardSkillState(cardId: string): CardSkillState {
  return readSkillProgressMap()[cardId] ?? {};
}

export function saveCardSkillProgress(cardId: string, skill: ProductiveSkill, progress: SkillProgress): void {
  if (typeof window === "undefined") return;
  try {
    const all = readSkillProgressMap();
    all[cardId] = { ...all[cardId], [skill]: progress };
    localStorage.setItem(getNsKey(SKILL_PROGRESS_KEY), JSON.stringify(all));
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
    const all = JSON.parse(localStorage.getItem(getNsKey(DISCUSS_CACHE_KEY)) ?? "[]") as DiscussCacheEntry[];
    return all.find((entry) => entry.key === key)?.messages ?? [];
  } catch {
    return [];
  }
}

export function saveLocalDiscussHistory(key: string, messages: DiscussMessage[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(DISCUSS_CACHE_KEY)) ?? "[]") as DiscussCacheEntry[];
    const idx = all.findIndex((entry) => entry.key === key);
    const entry: DiscussCacheEntry = { key, messages, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(getNsKey(DISCUSS_CACHE_KEY), JSON.stringify(all.slice(-120)));
  } catch {
    // silently fail
  }
}

// --- SRS Session (daily training progress persistence) ---

const SRS_SESSION_KEY = "aibook_srs_session";

type SrsSession = {
  date: string; // YYYY-MM-DD
  reviewedIds: string[];
  currentIndex: number;
};

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export function getSrsSession(): SrsSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getNsKey(SRS_SESSION_KEY));
    if (!raw) return null;
    const session = JSON.parse(raw) as SrsSession;
    if (session.date !== todayStr()) return null; // stale — different day
    return session;
  } catch {
    return null;
  }
}

export function saveSrsSession(reviewedIds: string[], currentIndex: number): void {
  try {
    const session: SrsSession = { date: todayStr(), reviewedIds, currentIndex };
    localStorage.setItem(getNsKey(SRS_SESSION_KEY), JSON.stringify(session));
  } catch {
    // ignore
  }
}

export function clearSrsSession(): void {
  try {
    localStorage.removeItem(getNsKey(SRS_SESSION_KEY));
  } catch {
    // ignore
  }
}

export function getLocalLastView(): LocalLastView | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(getNsKey(LAST_VIEW_KEY)) ?? "null") as LocalLastView | null;
  } catch {
    return null;
  }
}

export function saveLocalLastView(section: string, bookId?: string | null): void {
  try {
    localStorage.setItem(getNsKey(LAST_VIEW_KEY), JSON.stringify({
      section,
      bookId: bookId ?? null,
      updatedAt: new Date().toISOString(),
    }));
  } catch {
    // silently fail
  }
}
