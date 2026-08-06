// Shared model call for the lesson routes (generate + refine). Both send one
// prompt and expect the same JSON lesson back, so the model config, the JSON
// parsing and the failure messages live here rather than being copied.

import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from "@/lib/config";
import { parseGeneratedLesson, type GeneratedLesson } from "./buildLessonPrompt";

// A reading text is far longer than the per-word analyses the shared
// AI_CONFIG budget is sized for.
const LESSON_MAX_OUTPUT_TOKENS = 4096;

// Higher than the analysis routes: a reading text should vary between runs,
// otherwise every lesson on the same topic comes out identical.
const LESSON_TEMPERATURE = 0.9;

export type ImageModelResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status: number };

/**
 * One multimodal call: a photo plus a prompt, JSON back.
 *
 * Returns the parsed JSON untouched — the photo step has its own shape, unlike
 * the lesson steps, so narrowing happens at the call site.
 */
export async function runImagePrompt(
  apiKey: string,
  prompt: string,
  imageBase64: string,
  mimeType: string,
): Promise<ImageModelResult> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: LESSON_MAX_OUTPUT_TOKENS,
        // Transcription is not a creative task: the same photo should read the
        // same way every time.
        temperature: 0,
      },
    });

    const result = await model.generateContent([
      { inlineData: { data: imageBase64, mimeType } },
      { text: prompt },
    ]);

    try {
      return { ok: true, data: JSON.parse(result.response.text()) };
    } catch {
      return { ok: false, error: "Модель вернула некорректный JSON. Попробуйте ещё раз.", status: 502 };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Неизвестная ошибка", status: 500 };
  }
}

export type LessonModelResult =
  | { ok: true; lesson: GeneratedLesson }
  | { ok: false; error: string; status: number };

export async function runLessonPrompt(apiKey: string, prompt: string): Promise<LessonModelResult> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: LESSON_MAX_OUTPUT_TOKENS,
        temperature: LESSON_TEMPERATURE,
      },
    });

    const result = await model.generateContent(prompt);
    const rawText = result.response.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      return { ok: false, error: "Модель вернула некорректный JSON. Попробуйте ещё раз.", status: 502 };
    }

    const lesson = parseGeneratedLesson(parsed);
    if (!lesson) {
      return { ok: false, error: "Не удалось разобрать ответ модели. Попробуйте ещё раз.", status: 502 };
    }

    return { ok: true, lesson };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Неизвестная ошибка", status: 500 };
  }
}
