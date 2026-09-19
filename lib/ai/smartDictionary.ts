import { GoogleGenAI, Type } from "@google/genai";
import { AI_CONFIG } from "@/lib/config";
import { parseModelJson } from "./jsonResponse";

const SMART_DICTIONARY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    topic: { type: Type.STRING },
    description: { type: Type.STRING },
    clarification: { type: Type.STRING },
    done: { type: Type.BOOLEAN },
    entries: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          headword: { type: Type.STRING },
          lemma: { type: Type.STRING },
          translation: { type: Type.STRING },
          partOfSpeech: { type: Type.STRING },
          contentType: { type: Type.STRING },
          gender: { type: Type.STRING },
          article: { type: Type.STRING },
          plural: { type: Type.STRING },
          forms: {
            type: Type.OBJECT,
            properties: {
              praeteritum: { type: Type.STRING },
              partizip2: { type: Type.STRING },
              hilfsverb: { type: Type.STRING },
              trennbar: { type: Type.STRING },
              komparativ: { type: Type.STRING },
              superlativ: { type: Type.STRING },
            },
            required: ["praeteritum", "partizip2", "hilfsverb", "trennbar"],
          },
          cefr: { type: Type.STRING },
          note: { type: Type.STRING },
          example: { type: Type.STRING },
          exampleTranslation: { type: Type.STRING },
        },
        required: ["headword", "lemma", "translation", "partOfSpeech", "cefr", "forms"],
      },
    },
  },
  required: ["entries", "done"],
} as const;

export type SmartDictionaryModelResult =
  | { ok: true; value: unknown; repaired: boolean }
  | { ok: false; error: string; status: number };

export function smartDictionaryClarification(value: unknown, validEntryCount: number): string {
  if (validEntryCount > 0 || typeof value !== "string") return "";
  const clarification = value.trim().slice(0, 500);
  if (/^(?:none|null|n\/?a|нет|не требуется)[.!]?$/iu.test(clarification)) return "";
  return clarification;
}

function describeError(error: unknown): { error: string; status: number } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401") || lower.includes("403")) {
    return { error: "Ключ Gemini не принят. Проверьте его в настройках.", status: 403 };
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("resource_exhausted")) {
    return { error: "Google временно ограничил запросы. Подождите минуту и попробуйте ещё раз.", status: 429 };
  }
  if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("fetch failed")) {
    return { error: "Не дождались ответа модели. Проверьте связь и попробуйте ещё раз.", status: 504 };
  }
  return { error: raw || "Модель не смогла собрать словарь.", status: 502 };
}

export async function runSmartDictionaryPrompt(
  apiKey: string,
  prompt: string,
  maxOutputTokens = 14000,
): Promise<SmartDictionaryModelResult> {
  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: AI_CONFIG.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: SMART_DICTIONARY_SCHEMA as never,
        maxOutputTokens,
        temperature: 0.15,
        thinkingConfig: { thinkingBudget: 1024 },
      },
    });

    let raw = "";
    try { raw = response.text ?? ""; } catch { raw = ""; }
    const parsed = parseModelJson(raw);
    if (!parsed.ok) return { ok: false, error: "Модель вернула неполный ответ. Попробуйте ещё раз.", status: 502 };
    return { ok: true, value: parsed.value, repaired: parsed.repaired };
  } catch (error) {
    return { ok: false, ...describeError(error) };
  }
}
