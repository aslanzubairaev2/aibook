import type { AiAnalysis, Book, CardSkillState, CardVariantState, DiscussMessage, Flashcard, GrammarTable, PackSort, ProductiveSkill, ReaderSelectionSnapshot, SkillProgress, TrainVariant, UserProfile } from "@/lib/types";
import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";
import { DEFAULT_QUIZ_MODES, QUIZ_MODE_ORDER, type QuizMode } from "@/lib/verbsQuizModes";
import { normalizeTtsProvider } from "@/lib/ttsProviders";

const BOOKS_KEY = "aibook_books";
const CARDS_KEY = "aibook_cards";
const PROFILE_KEY = "aibook_profile";
const PROGRESS_KEY = "aibook_progress";
const AI_CACHE_KEY = "aibook_ai_selection_cache";
const GRAMMAR_CACHE_KEY = "aibook_grammar_cache";
const VERB_PHRASE_CACHE_KEY = "aibook_verb_phrase_cache";
const SKILL_PROGRESS_KEY = "aibook_skill_progress";
const VARIANT_PROGRESS_KEY = "aibook_variant_progress";
const DISCUSS_CACHE_KEY = "aibook_discuss_cache";
const READER_SELECTION_KEY = "aibook_reader_selection";
const LAST_VIEW_KEY = "aibook_last_view";
const VERBS_DICT_CACHE_KEY = "aibook_verbs_dict_cache";
const VERBS_OPEN_GROUPS_KEY = "aibook_verbs_open_groups";
const VERBS_HIDE_FORMS_KEY = "aibook_verbs_hide_forms";
const VERBS_QUIZ_MODES_KEY = "aibook_verbs_quiz_modes";

let activeNamespace = "guest";
// The stored namespace is read once. Re-reading it inside getNsKey meant a
// localStorage round-trip for every single lookup, and the training queue does
// thousands of those per render.
let namespaceLoaded = false;

export function setLocalNamespace(ns: string) {
  if (ns !== activeNamespace) invalidateReadCaches();
  activeNamespace = ns;
  namespaceLoaded = true;
  if (typeof window !== "undefined") {
    try {
      localStorage.setItem("aibook_active_namespace", ns);
    } catch {
      // ignore
    }
  }
}

export function getLocalNamespace(): string {
  if (!namespaceLoaded && typeof window !== "undefined") {
    try {
      activeNamespace = localStorage.getItem("aibook_active_namespace") ?? activeNamespace;
    } catch {
      // Keep whatever the process already had.
    }
    namespaceLoaded = true;
  }
  return activeNamespace;
}

// The legacy → namespaced copy only has to happen once per key per session.
const migratedKeys = new Set<string>();

function getNsKey(baseKey: string): string {
  const ns = getLocalNamespace();
  const nsKey = `ns:${ns}:${baseKey}`;

  if (typeof window !== "undefined" && ns === "guest" && !migratedKeys.has(nsKey)) {
    migratedKeys.add(nsKey);
    try {
      // If namespaced key doesn't exist but legacy key does, migrate/copy it
      if (localStorage.getItem(nsKey) === null) {
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

// --- Parsed-value cache ------------------------------------------------------
//
// The collections below (cards, per-variant progress, per-skill progress) are
// read far more often than they are written — a single training render asks for
// one card's variant progress thousands of times. Parsing the whole collection
// on each of those reads is what made a 500-card deck unusable, so the parsed
// value is held in memory and dropped whenever it could have changed: a write
// here, a namespace switch, or another tab writing the same key.

type ReadCache<T> = { key: string; value: T } | null;

let cardsCache: ReadCache<Flashcard[]> = null;
let variantCache: ReadCache<VariantProgressMap> = null;
let skillCache: ReadCache<SkillProgressMap> = null;

function invalidateReadCaches() {
  cardsCache = null;
  variantCache = null;
  skillCache = null;
  migratedKeys.clear();
}

let crossTabWatcherReady = false;

/** Another tab writing the same account's storage must not leave us stale. */
function watchCrossTabWrites() {
  if (crossTabWatcherReady || typeof window === "undefined") return;
  crossTabWatcherReady = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null) {
      invalidateReadCaches();
      return;
    }
    if (event.key.endsWith(CARDS_KEY)) cardsCache = null;
    if (event.key.endsWith(VARIANT_PROGRESS_KEY)) variantCache = null;
    if (event.key.endsWith(SKILL_PROGRESS_KEY)) skillCache = null;
  });
}

function readCached<T>(cache: ReadCache<T>, nsKey: string, parse: () => T): { cache: ReadCache<T>; value: T } {
  if (cache?.key === nsKey) return { cache, value: cache.value };
  watchCrossTabWrites();
  const value = parse();
  return { cache: { key: nsKey, value }, value };
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

/**
 * The cached array is shared, not copied — callers must treat it as read-only
 * and replace rather than mutate (which is what every caller already does).
 */
export function getLocalCards(): Flashcard[] {
  if (typeof window === "undefined") return [];
  const nsKey = getNsKey(CARDS_KEY);
  const read = readCached(cardsCache, nsKey, () => {
    try {
      return JSON.parse(localStorage.getItem(nsKey) ?? "[]") as Flashcard[];
    } catch {
      return [];
    }
  });
  cardsCache = read.cache;
  return read.value;
}

export function saveLocalCard(card: Flashcard): void {
  const cards = getLocalCards();
  const idx = cards.findIndex((c) => c.id === card.id);
  const next = idx >= 0
    ? cards.map((c, i) => (i === idx ? card : c))
    : [card, ...cards];
  saveLocalCards(next);
}

export function saveLocalCards(cards: Flashcard[]): void {
  if (typeof window === "undefined") return;
  const nsKey = getNsKey(CARDS_KEY);
  cardsCache = { key: nsKey, value: cards };
  try {
    localStorage.setItem(nsKey, JSON.stringify(cards));
  } catch {
    // Storage full or unavailable — the in-memory copy still serves this session.
  }
}

export function deleteLocalCard(id: string): void {
  saveLocalCards(getLocalCards().filter((c) => c.id !== id));
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
  ttsProvider: "gemini",
};

export function getLocalProfile(): UserProfile {
  if (typeof window === "undefined") return defaultProfile;
  try {
    const stored = localStorage.getItem(getNsKey(PROFILE_KEY));
    if (!stored) return defaultProfile;
    const parsed = JSON.parse(stored) as Partial<UserProfile>;
    return {
      ...defaultProfile,
      ...parsed,
      ttsProvider: normalizeTtsProvider(parsed.ttsProvider),
    };
  } catch {
    return defaultProfile;
  }
}

export function saveLocalProfile(profile: UserProfile): void {
  localStorage.setItem(getNsKey(PROFILE_KEY), JSON.stringify({
    ...profile,
    ttsProvider: normalizeTtsProvider(profile.ttsProvider),
  }));
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

// --- Dictionary: how the packs are ordered ---
//
// Kept on the device rather than in the profile: this is how the learner likes
// to look at the list, not part of what they are studying.

const DICT_SORT_KEY = "aibook_dict_sort";

const PACK_SORTS: PackSort[] = ["new", "unlearned", "progress", "title"];

export function getLocalPackSort(): PackSort {
  if (typeof window === "undefined") return "new";
  try {
    const stored = localStorage.getItem(getNsKey(DICT_SORT_KEY)) as PackSort | null;
    return stored && PACK_SORTS.includes(stored) ? stored : "new";
  } catch {
    return "new";
  }
}

export function saveLocalPackSort(sort: PackSort): void {
  try {
    localStorage.setItem(getNsKey(DICT_SORT_KEY), sort);
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

export type VerbPhrase = { example: string; exampleTranslation: string };
type VerbPhraseCacheEntry = { key: string; value: VerbPhrase; updatedAt: string };

// One generated example sentence per verb, for the "phrases" quiz drill —
// cached exactly like the grammar tables so retraining the same verb (or
// retrying a mistake in the same session) costs no second AI call.
export function getLocalVerbPhrase(key: string): VerbPhrase | null {
  if (typeof window === "undefined") return null;
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(VERB_PHRASE_CACHE_KEY)) ?? "[]") as VerbPhraseCacheEntry[];
    return all.find((entry) => entry.key === key)?.value ?? null;
  } catch {
    return null;
  }
}

export function saveLocalVerbPhrase(key: string, value: VerbPhrase): void {
  try {
    const all = JSON.parse(localStorage.getItem(getNsKey(VERB_PHRASE_CACHE_KEY)) ?? "[]") as VerbPhraseCacheEntry[];
    const idx = all.findIndex((entry) => entry.key === key);
    const entry: VerbPhraseCacheEntry = { key, value, updatedAt: new Date().toISOString() };
    if (idx >= 0) all[idx] = entry;
    else all.push(entry);
    localStorage.setItem(getNsKey(VERB_PHRASE_CACHE_KEY), JSON.stringify(all.slice(-150)));
  } catch {
    // silently fail
  }
}

// The Глаголы screen's dictionary read, cached so the screen shows the
// learner's verbs instantly on every open — including a fresh page load —
// instead of a blank "Загружаю глаголы..." spinner while the network round
// trip that already ran once repeats itself. The screen still refreshes from
// the server in the background; this is only what renders while that runs.
type VerbsDictCache = { language: string; entries: DictionaryEntry[]; batches: DictionaryBatch[] };

export function getLocalVerbsDict(language: string): { entries: DictionaryEntry[]; batches: DictionaryBatch[] } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getNsKey(VERBS_DICT_CACHE_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as VerbsDictCache;
    if (parsed.language !== language) return null;
    return { entries: parsed.entries ?? [], batches: parsed.batches ?? [] };
  } catch {
    return null;
  }
}

export function saveLocalVerbsDict(language: string, entries: DictionaryEntry[], batches: DictionaryBatch[]): void {
  try {
    const payload: VerbsDictCache = { language, entries, batches };
    localStorage.setItem(getNsKey(VERBS_DICT_CACHE_KEY), JSON.stringify(payload));
  } catch {
    // silently fail
  }
}

// Whether the Глаголы table is covering its Präteritum/Partizip II columns —
// the learner's self-test mode, remembered so it survives leaving the screen.
export function getLocalVerbsHideForms(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(getNsKey(VERBS_HIDE_FORMS_KEY)) === "1";
  } catch {
    return false;
  }
}

export function saveLocalVerbsHideForms(hidden: boolean): void {
  try {
    localStorage.setItem(getNsKey(VERBS_HIDE_FORMS_KEY), hidden ? "1" : "0");
  } catch {
    // silently fail
  }
}

// Which drills the verb trainer runs. Defaults to just "forms" — the trainer
// that existed before modes did — so nobody who never opens the settings gets
// a heavier session than the one they already knew.
export function getLocalVerbsQuizModes(): Set<QuizMode> {
  if (typeof window === "undefined") return new Set(DEFAULT_QUIZ_MODES);
  try {
    const raw = localStorage.getItem(getNsKey(VERBS_QUIZ_MODES_KEY));
    if (!raw) return new Set(DEFAULT_QUIZ_MODES);
    const arr = JSON.parse(raw) as string[];
    const valid = Array.isArray(arr) ? arr.filter((m): m is QuizMode => QUIZ_MODE_ORDER.includes(m as QuizMode)) : [];
    return new Set(valid.length ? valid : DEFAULT_QUIZ_MODES);
  } catch {
    return new Set(DEFAULT_QUIZ_MODES);
  }
}

export function saveLocalVerbsQuizModes(modes: Set<QuizMode>): void {
  try {
    localStorage.setItem(getNsKey(VERBS_QUIZ_MODES_KEY), JSON.stringify([...modes]));
  } catch {
    // silently fail
  }
}

// Which verb packs are expanded on the Глаголы screen. Stored as the OPEN set
// (not collapsed) so a pack never seen before defaults to closed, per the
// learner's request — only packs they actually opened stay open next time.
export function getLocalVerbsOpenGroups(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(getNsKey(VERBS_OPEN_GROUPS_KEY));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

export function saveLocalVerbsOpenGroups(keys: Set<string>): void {
  try {
    localStorage.setItem(getNsKey(VERBS_OPEN_GROUPS_KEY), JSON.stringify([...keys]));
  } catch {
    // silently fail
  }
}

// Productive-recall progress, keyed by card id → per-skill SRS state.
// Stored locally only (the remote flashcards table has no columns for it).
type SkillProgressMap = Record<string, CardSkillState>;

function readSkillProgressMap(): SkillProgressMap {
  if (typeof window === "undefined") return {};
  const nsKey = getNsKey(SKILL_PROGRESS_KEY);
  const read = readCached(skillCache, nsKey, () => {
    try {
      return JSON.parse(localStorage.getItem(nsKey) ?? "{}") as SkillProgressMap;
    } catch {
      return {};
    }
  });
  skillCache = read.cache;
  return read.value;
}

/** Reads every card's productive-skill progress in one pass. */
export function getCardSkillProgressMap(): SkillProgressMap {
  return readSkillProgressMap();
}

export function getCardSkillState(cardId: string): CardSkillState {
  return readSkillProgressMap()[cardId] ?? {};
}

export function saveCardSkillProgress(cardId: string, skill: ProductiveSkill, progress: SkillProgress): void {
  if (typeof window === "undefined") return;
  const nsKey = getNsKey(SKILL_PROGRESS_KEY);
  const previous = readSkillProgressMap();
  const all = { ...previous, [cardId]: { ...previous[cardId], [skill]: progress } };
  skillCache = { key: nsKey, value: all };
  try {
    localStorage.setItem(nsKey, JSON.stringify(all));
  } catch {
    // silently fail
  }
}

// Recognize-mode "reverse"/"audio" variant progress, keyed by card id. The
// "forward" variant lives on the Flashcard itself; these two get their own
// independent schedule, stored locally only — same pattern as skill progress.
type VariantProgressMap = Record<string, CardVariantState>;

function readVariantProgressMap(): VariantProgressMap {
  if (typeof window === "undefined") return {};
  const nsKey = getNsKey(VARIANT_PROGRESS_KEY);
  const read = readCached(variantCache, nsKey, () => {
    try {
      return JSON.parse(localStorage.getItem(nsKey) ?? "{}") as VariantProgressMap;
    } catch {
      return {};
    }
  });
  variantCache = read.cache;
  return read.value;
}

export function getCardVariantState(cardId: string): CardVariantState {
  return readVariantProgressMap()[cardId] ?? {};
}

/** Reads every card variant in one pass for aggregate progress displays. */
export function getCardVariantProgressMap(): Record<string, CardVariantState> {
  return readVariantProgressMap();
}

/** Replaces the local mirror after it has been merged with Supabase progress. */
export function saveCardVariantProgressMap(progress: Record<string, CardVariantState>): void {
  if (typeof window === "undefined") return;
  const nsKey = getNsKey(VARIANT_PROGRESS_KEY);
  variantCache = { key: nsKey, value: progress };
  try {
    localStorage.setItem(nsKey, JSON.stringify(progress));
  } catch {
    // Keep the app usable when browser storage is unavailable.
  }
}

export function saveCardVariantProgress(cardId: string, variant: Exclude<TrainVariant, "forward">, progress: SkillProgress): void {
  if (typeof window === "undefined") return;
  const previous = readVariantProgressMap();
  // A fresh object identity, so a memo keyed on the map notices the change.
  saveCardVariantProgressMap({ ...previous, [cardId]: { ...previous[cardId], [variant]: progress } });
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
