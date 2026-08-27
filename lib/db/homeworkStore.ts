// Writing a photographed homework page into shared_books + shared_book_chapters.
//
// Same two tables the reading lessons use (lessonStore.ts), on purpose: the
// catalogue, the library, and lesson-progress all key off shared_books/
// shared_book_chapters already, and a homework set is still just a lesson the
// learner owns. What differs is metadata.lesson_kind ("homework" instead of
// "text"/"lesson") and the chapter's "paragraphs" column, which for a homework
// set holds the exercises array itself (jsonb accepts any JSON, not only an
// array of strings) rather than prose.

import type { SupabaseClient } from "@supabase/supabase-js";
import { AI_CONFIG } from "@/lib/config";
import { pickCoverColor } from "@/lib/db/lessonStore";
import type { HomeworkLesson } from "@/lib/ai/buildHomeworkPrompt";

/** Flattened text for shared_book_chapters.plain_text and the char_count column — search and length only, never rendered. */
function homeworkToPlainText(lesson: HomeworkLesson): string {
  const lines: string[] = [];
  for (const exercise of lesson.exercises) {
    lines.push(`${exercise.number}. ${exercise.instruction}`);
    for (const item of exercise.items ?? []) lines.push(item.text);
    if (exercise.verbs) lines.push(exercise.verbs.join(", "));
  }
  return lines.join("\n");
}

export type SaveHomeworkInput = {
  userId: string;
  lesson: HomeworkLesson;
  targetLanguage: string;
  nativeLanguage: string;
  /** The date the homework is for, as the learner entered it — required, there is no reliable default. */
  homeworkDate: string;
  /** Route-specific extras: the photographed page's source_kind, whether the model's answer was truncated, etc. */
  extraMetadata?: Record<string, unknown>;
};

export type SaveHomeworkResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export async function saveHomeworkLesson(
  admin: SupabaseClient,
  input: SaveHomeworkInput,
): Promise<SaveHomeworkResult> {
  const { lesson } = input;
  const plainText = homeworkToPlainText(lesson);
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
      cefr_level: null,
      course_id: `generated_${input.userId}`,
      course_title: "Мои уроки",
      lesson_order: null,
      total_chars: plainText.length,
      metadata: {
        description: lesson.description,
        lesson_kind: "homework",
        cover_color: pickCoverColor(lesson.title),
        native_language: input.nativeLanguage,
        source_kind: lesson.sourceKind,
        homework_date: input.homeworkDate,
        generated_at: new Date().toISOString(),
        model: AI_CONFIG.model,
        ...input.extraMetadata,
      },
    })
    .select("id")
    .single();

  if (bookError || !bookData) {
    console.error("saveHomeworkLesson insert:", bookError?.message);
    return { ok: false, error: "Не удалось сохранить домашнее задание." };
  }

  const { error: chapterError } = await admin.from("shared_book_chapters").insert({
    shared_book_id: bookData.id,
    chapter_index: 0,
    title: lesson.title,
    // The exercises themselves, not prose — shared_book_chapters.paragraphs is
    // jsonb precisely so a row can hold either shape.
    paragraphs: lesson.exercises,
    plain_text: plainText,
    char_count: plainText.length,
  });

  if (chapterError) {
    await admin.from("shared_books").delete().eq("id", bookData.id);
    console.error("saveHomeworkLesson chapter insert:", chapterError.message);
    return { ok: false, error: "Не удалось сохранить упражнения." };
  }

  return { ok: true, id: bookData.id };
}
