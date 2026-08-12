// The model calls behind the lesson routes: reading a photo, and turning what
// it says into a lesson.
//
// Written defensively on purpose. These calls were failing often enough to make
// the feature unusable, and the reason was never the model's understanding —
// it was the plumbing:
//
//   - Gemini 3 models think before answering, and thinking tokens come out of
//     the same output budget as the answer. A book page transcribed under a
//     4096-token ceiling spent most of it thinking and got cut off mid-JSON.
//   - A cut-off answer went to JSON.parse, threw, and surfaced as "не удалось
//     разобрать ответ ИИ" — a message that names neither the cause nor a way out.
//   - A blocked or empty response threw inside the SDK and came back as a raw
//     English error.
//
// So: thinking is switched off where the job is transcription rather than
// reasoning, the ceiling is sized for a full page, the response shape is
// declared as a schema, a truncated answer is salvaged, and every remaining
// failure is named in a sentence the learner can act on.

import { GoogleGenAI, Type, type GenerateContentResponse, type Part } from "@google/genai";
import { AI_CONFIG } from "@/lib/config";
import { parseModelJson } from "./jsonResponse";
import { parseGeneratedLesson, type GeneratedLesson } from "./buildLessonPrompt";

/**
 * Room for a dense page of text plus the glossary around it. Well under the
 * model's ceiling, and irrelevant to cost: output is billed per token
 * produced, not per token allowed.
 */
const PAGE_MAX_OUTPUT_TOKENS = 16384;

/** Generated lessons are short by construction and never need the full ceiling. */
const LESSON_MAX_OUTPUT_TOKENS = 8192;

// Higher than the analysis routes: a reading text should vary between runs,
// otherwise every lesson on the same topic comes out identical.
const LESSON_TEMPERATURE = 0.9;

/** Points the SDK at a stand-in service in tests; unset in production. */
const BASE_URL = process.env.GEMINI_API_BASE_URL;

function client(apiKey: string): GoogleGenAI {
  return new GoogleGenAI(BASE_URL ? { apiKey, httpOptions: { baseUrl: BASE_URL } } : { apiKey });
}

// ─── What went wrong, in words the learner can act on ────────────────────────

type Failure = { error: string; status: number };

function describeFinish(response: GenerateContentResponse): Failure | null {
  const candidate = response.candidates?.[0];
  const blockReason = response.promptFeedback?.blockReason;
  if (blockReason) {
    return {
      error: "Запрос отклонён фильтром безопасности Google. Попробуйте другой снимок или другую формулировку.",
      status: 422,
    };
  }
  switch (candidate?.finishReason) {
    case "MAX_TOKENS":
      return { error: "Ответ модели не поместился целиком. Попробуйте снять текст по частям.", status: 502 };
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
      return { error: "Модель отказалась обрабатывать этот материал.", status: 422 };
    case "RECITATION":
      return { error: "Модель распознала защищённый авторским правом текст и не стала его воспроизводить.", status: 422 };
    default:
      return null;
  }
}

/** Turn an SDK/transport error into something meaningful. */
function describeThrow(err: unknown): Failure {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401") || lower.includes("403")) {
    return { error: "Ключ Gemini не принят. Проверьте его в настройках.", status: 403 };
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("resource_exhausted")) {
    return { error: "Google временно ограничил запросы (превышена квота). Подождите минуту и попробуйте снова.", status: 429 };
  }
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("overloaded")) {
    return { error: "Сервис Gemini сейчас перегружен. Попробуйте через минуту.", status: 503 };
  }
  if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("fetch failed")) {
    return { error: "Не дождались ответа модели. Проверьте связь и попробуйте ещё раз.", status: 504 };
  }
  if (lower.includes("not found") || lower.includes("404")) {
    return { error: `Модель ${AI_CONFIG.model} недоступна для этого ключа.`, status: 502 };
  }
  return { error: raw || "Неизвестная ошибка", status: 500 };
}

// ─── Response shapes, declared rather than requested ─────────────────────────

const EXTRACT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    language: { type: Type.STRING },
    languages: { type: Type.ARRAY, items: { type: Type.STRING } },
    isStudyMaterial: { type: Type.BOOLEAN },
    kind: { type: Type.STRING },
    text: { type: Type.STRING },
  },
  required: ["language", "text"],
} as const;

const LESSON_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    paragraphs: { type: Type.ARRAY, items: { type: Type.STRING } },
    vocabulary: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: { term: { type: Type.STRING }, translation: { type: Type.STRING } },
        required: ["term", "translation"],
      },
    },
    questions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["title", "paragraphs"],
} as const;

// ─── The call ────────────────────────────────────────────────────────────────

type CallOptions = {
  apiKey: string;
  parts: (Part | string)[];
  schema: unknown;
  maxOutputTokens: number;
  temperature: number;
  /**
   * Thinking earns its cost on composition and wastes the output budget on
   * transcription. Off for reproducing a source, on for writing one.
   */
  think: boolean;
};

type CallResult =
  | { ok: true; value: unknown; repaired: boolean }
  | ({ ok: false } & Failure);

async function callJson(options: CallOptions): Promise<CallResult> {
  let response: GenerateContentResponse;
  try {
    response = await client(options.apiKey).models.generateContent({
      model: AI_CONFIG.model,
      contents: [{ role: "user", parts: options.parts.map((p) => (typeof p === "string" ? { text: p } : p)) }],
      config: {
        responseMimeType: "application/json",
        responseSchema: options.schema as never,
        maxOutputTokens: options.maxOutputTokens,
        temperature: options.temperature,
        ...(options.think ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      },
    });
  } catch (err) {
    return { ok: false, ...describeThrow(err) };
  }

  // `.text` is a getter that can throw on a blocked response, so the reason is
  // checked first and the read itself is guarded.
  let raw = "";
  try {
    raw = response.text ?? "";
  } catch {
    raw = "";
  }

  const parsed = parseModelJson(raw);
  if (!parsed.ok) {
    const finish = describeFinish(response);
    if (finish) return { ok: false, ...finish };
    return {
      ok: false,
      error: raw.trim()
        ? "Модель ответила не в том формате. Попробуйте ещё раз."
        : "Модель вернула пустой ответ. Попробуйте ещё раз.",
      status: 502,
    };
  }

  return { ok: true, value: parsed.value, repaired: parsed.repaired };
}

// ─── Reading a photo ─────────────────────────────────────────────────────────

export type ImageModelResult =
  | { ok: true; data: unknown; truncated: boolean }
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
  const result = await callJson({
    apiKey,
    parts: [{ inlineData: { data: imageBase64, mimeType } }, prompt],
    schema: EXTRACT_SCHEMA,
    maxOutputTokens: PAGE_MAX_OUTPUT_TOKENS,
    // Transcription is not a creative task: the same photo should read the
    // same way every time, and no thinking budget should be spent on it.
    temperature: 0,
    think: false,
  });

  if (!result.ok) return { ok: false, error: result.error, status: result.status };
  return { ok: true, data: result.value, truncated: result.repaired };
}

// ─── Writing the lesson ──────────────────────────────────────────────────────

export type LessonModelResult =
  | { ok: true; lesson: GeneratedLesson; truncated: boolean }
  | { ok: false; error: string; status: number };

export type RunLessonOptions = {
  /**
   * The output must reproduce a source rather than invent one: a photographed
   * document restored or translated. Variation between runs is a defect there,
   * the result can be as long as the original, and thinking adds nothing.
   */
  faithful?: boolean;
};

export async function runLessonPrompt(
  apiKey: string,
  prompt: string,
  options: RunLessonOptions = {},
): Promise<LessonModelResult> {
  const faithful = options.faithful === true;

  const attempt = async (): Promise<LessonModelResult> => {
    const result = await callJson({
      apiKey,
      parts: [prompt],
      schema: LESSON_SCHEMA,
      maxOutputTokens: faithful ? PAGE_MAX_OUTPUT_TOKENS : LESSON_MAX_OUTPUT_TOKENS,
      temperature: faithful ? 0 : LESSON_TEMPERATURE,
      think: !faithful,
    });
    if (!result.ok) return { ok: false, error: result.error, status: result.status };

    const lesson = parseGeneratedLesson(result.value);
    if (!lesson) {
      return { ok: false, error: "Модель не вернула текст урока. Попробуйте ещё раз.", status: 502 };
    }
    return { ok: true, lesson, truncated: result.repaired };
  };

  const first = await attempt();
  if (first.ok) return first;

  // One retry, and only for the failures a retry actually fixes: an answer
  // that was malformed, empty, or the wrong shape. Quota and safety refusals
  // repeat identically, so retrying them just doubles the wait before the
  // same message.
  if (first.status !== 502) return first;
  return attempt();
}
