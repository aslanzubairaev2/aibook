// Writing a generated lesson into shared_books + shared_book_chapters.
//
// Three routes produce lessons now (a topic, a photo, a photo in another
// language) and they all have to land identically — same source_type, same
// owner scoping, same metadata keys — or the catalogue and the revise flow
// would treat them differently.

import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_CONFIG } from "@/lib/config";
import { lessonToParagraphs, type GeneratedLesson } from "@/lib/ai/buildLessonPrompt";
import { vocabMetadata } from "@/lib/text/vocab";
import type { CefrLevel } from "@/lib/types";

const COVER_COLORS = [
  "linear-gradient(160deg, #c49a28 0%, #7a5c10 100%)",
  "linear-gradient(160deg, #4a7a5c 0%, #254030 100%)",
  "linear-gradient(160deg, #3a5c8a 0%, #1a2c4a 100%)",
  "linear-gradient(160deg, #8a3a3a 0%, #4a1a1a 100%)",
  "linear-gradient(160deg, #6a3a8a 0%, #35174a 100%)",
  "linear-gradient(160deg, #8a5a2a 0%, #4a2a0a 100%)",
];

export function pickCoverColor(title: string): string {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

export type SaveLessonInput = {
  userId: string;
  lesson: GeneratedLesson;
  level: CefrLevel;
  targetLanguage: string;
  nativeLanguage: string;
  /** Route-specific extras: the topic, the photo's detected language, etc. */
  extraMetadata?: Record<string, unknown>;
};

export type SaveLessonResult =
  | { ok: true; id: string; paragraphs: string[] }
  | { ok: false; error: string };

export async function saveGeneratedLesson(
  admin: SupabaseClient,
  input: SaveLessonInput,
): Promise<SaveLessonResult> {
  const { lesson } = input;
  const paragraphs = lessonToParagraphs(lesson);
  const charCount = paragraphs.join("").length;
  // source_id must stay unique per row — UNIQUE (source_type, source_id) is
  // global, not per user.
  const sourceId = `generated_${crypto.randomUUID()}`;

  const { data: bookData, error: bookError } = await admin
    .from("shared_books")
    .insert({
      source_type: "generated",
      source_id: sourceId,
      owner_user_id: input.userId,
      title: lesson.title,
      author: "AI",
      language: input.targetLanguage,
      cefr_level: input.level,
      course_id: `generated_${input.userId}`,
      course_title: "Мои уроки",
      lesson_order: null,
      total_chars: charCount,
      metadata: {
        description: lesson.description,
        cover_color: pickCoverColor(lesson.title),
        // Kept so a later revision can address the learner in the same language
        // without the client having to resend the profile.
        native_language: input.nativeLanguage,
        // How many leading paragraphs are the reading text itself. Revision
        // needs to feed back the prose without the glossary appended below it.
        body_paragraph_count: lesson.paragraphs.length,
        // Frequency data for the catalogue's coverage badge.
        ...vocabMetadata(lesson.paragraphs.join(" ")),
        generated_at: new Date().toISOString(),
        model: AI_CONFIG.model,
        ...input.extraMetadata,
      },
    })
    .select("id")
    .single();

  if (bookError || !bookData) {
    console.error("saveGeneratedLesson insert:", bookError?.message);
    return { ok: false, error: "Не удалось сохранить урок." };
  }

  const { error: chapterError } = await admin.from("shared_book_chapters").insert({
    shared_book_id: bookData.id,
    chapter_index: 0,
    title: lesson.title,
    paragraphs,
    plain_text: paragraphs.join("\n"),
    char_count: charCount,
  });

  if (chapterError) {
    // Leaving a lesson row with no text would show an unopenable card forever.
    await admin.from("shared_books").delete().eq("id", bookData.id);
    console.error("saveGeneratedLesson chapter insert:", chapterError.message);
    return { ok: false, error: "Не удалось сохранить текст урока." };
  }

  return { ok: true, id: bookData.id, paragraphs };
}
