import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl as string, supabaseAnonKey as string)
  : null;

// ─── Types mirroring DB schema ────────────────────────────────────────────────

export type DbBook = {
  id: string;
  user_id: string;
  title: string;
  author: string | null;
  language: string;
  format: "txt" | "epub";
  file_path: string;
  cover_url: string | null;
  total_chars: number;
  cover_color: string;
  created_at: string;
};

export type DbBookChapter = {
  id: string;
  user_id: string;
  book_id: string;
  chapter_index: number;
  title: string | null;
  paragraphs: string[];
  plain_text: string;
  char_count: number;
  created_at: string;
};

export type DbReadingProgress = {
  id: string;
  user_id: string;
  book_id: string;
  chapter_index: number;
  paragraph_index: number;
  scroll_pos: number;
  percentage: number;
  last_read_at: string;
  total_time_ms: number;
};

export type DbFlashcard = {
  id: string;
  user_id: string;
  vocabulary_item_id: string | null;
  front: string;
  back: string;
  source_book_title: string | null;
  selection_type: "word" | "phrase" | "sentence";
  repetitions: number;
  easiness_factor: number;
  interval_days: number;
  next_review_at: string | null;
  last_reviewed_at: string | null;
  created_at: string;
};

export type DbUserSettings = {
  user_id: string;
  native_language: string;
  active_target_lang: string;
  ui_language: string;
  updated_at: string;
};

// ─── Books ────────────────────────────────────────────────────────────────────

export async function sbGetBooks(userId: string): Promise<DbBook[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("books")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { console.error("sbGetBooks:", error.message); return []; }
  return (data ?? []) as DbBook[];
}

export async function sbGetChapters(bookId: string): Promise<DbBookChapter[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("book_chapters")
    .select("*")
    .eq("book_id", bookId)
    .order("chapter_index", { ascending: true });
  if (error) { console.error("sbGetChapters:", error.message); return []; }
  return (data ?? []) as DbBookChapter[];
}

export async function sbUpsertBook(book: Omit<DbBook, "created_at">): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("books")
    .upsert(book, { onConflict: "id" })
    .select("id")
    .single();
  if (error) { console.error("sbUpsertBook:", error.message); return null; }
  return (data as { id: string }).id;
}

export async function sbUpsertChapter(chapter: Omit<DbBookChapter, "created_at">): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("book_chapters")
    .upsert(chapter, { onConflict: "book_id,chapter_index" });
  if (error) console.error("sbUpsertChapter:", error.message);
}

export async function sbDeleteBook(bookId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("books").delete().eq("id", bookId);
  if (error) console.error("sbDeleteBook:", error.message);
}

// ─── Reading Progress ─────────────────────────────────────────────────────────

export async function sbGetProgress(userId: string): Promise<DbReadingProgress[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("reading_progress")
    .select("*")
    .eq("user_id", userId);
  if (error) { console.error("sbGetProgress:", error.message); return []; }
  return (data ?? []) as DbReadingProgress[];
}

export async function sbUpsertProgress(entry: Omit<DbReadingProgress, "id">): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("reading_progress")
    .upsert(entry, { onConflict: "user_id,book_id" });
  if (error) console.error("sbUpsertProgress:", error.message);
}

// ─── Flashcards ───────────────────────────────────────────────────────────────

export async function sbGetFlashcards(userId: string): Promise<DbFlashcard[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("flashcards")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) { console.error("sbGetFlashcards:", error.message); return []; }
  return (data ?? []) as DbFlashcard[];
}

export async function sbInsertFlashcard(card: Omit<DbFlashcard, "id" | "created_at">): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("flashcards")
    .insert(card)
    .select("id")
    .single();
  if (error) { console.error("sbInsertFlashcard:", error.message); return null; }
  return (data as { id: string }).id;
}

// ─── User Settings ────────────────────────────────────────────────────────────

export async function sbGetSettings(userId: string): Promise<DbUserSettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .single();
  if (error && error.code !== "PGRST116") { console.error("sbGetSettings:", error.message); }
  return (data ?? null) as DbUserSettings | null;
}

export async function sbUpsertSettings(settings: DbUserSettings): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from("user_settings")
    .upsert(settings, { onConflict: "user_id" });
  if (error) console.error("sbUpsertSettings:", error.message);
}
