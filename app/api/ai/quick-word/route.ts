import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import {
  buildQuickWordPrompt,
  normalizeQuickWordAnswer,
  type QuickWordPromptParams,
} from "@/lib/ai/buildQuickWordPrompt";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

/**
 * Быстрое превью слова.
 *
 * Единственная задача маршрута — минимальная задержка, поэтому здесь всё
 * урезано до предела: самый быстрый тир модели, 160 токенов на ответ,
 * temperature 0 (детерминированный ответ ещё и лучше кэшируется) и ровно
 * один вызов вместо трёх отдельных (`translate` + `noun-forms` + `verb-forms`).
 */
function parseJsonObject(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("AI returned invalid JSON");
  }
}

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = (await req.json()) as QuickWordPromptParams;
  if (!body.word?.trim()) {
    return NextResponse.json({ error: "Не указано слово." }, { status: 400 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 160,
        temperature: 0,
      },
    });

    const result = await model.generateContent(buildQuickWordPrompt(body));
    const parsed = parseJsonObject(result.response.text()) as Record<string, unknown>;
    return NextResponse.json({ word: normalizeQuickWordAnswer(parsed) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
