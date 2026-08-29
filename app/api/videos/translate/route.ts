import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { AI_CONFIG } from "@/lib/config";

export const runtime = "nodejs";

type RequestBody = {
  cues?: unknown;
  sourceLanguage?: unknown;
  targetLanguage?: unknown;
};

export async function POST(request: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(request);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Access denied" }, { status: 403 });
  }

  const body = await request.json() as RequestBody;
  const cues = Array.isArray(body.cues)
    ? body.cues.filter((cue): cue is string => typeof cue === "string" && cue.trim().length > 0).slice(0, 100)
    : [];
  const sourceLanguage = typeof body.sourceLanguage === "string" ? body.sourceLanguage : "de";
  const targetLanguage = typeof body.targetLanguage === "string" ? body.targetLanguage : "ru";

  if (cues.length === 0) return NextResponse.json({ translations: [] });

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: { responseMimeType: "application/json", temperature: 0, maxOutputTokens: 4096 },
    });
    const prompt = `Translate each numbered subtitle from ${sourceLanguage} to natural ${targetLanguage}.
Keep every translation short, faithful, and in the same order. Return only JSON:
{"translations":[{"i":1,"text":"..."}]}

${cues.map((cue, index) => `[${index + 1}] ${cue}`).join("\n")}`;
    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text()) as { translations?: { i?: number; text?: string }[] };
    const translations = cues.map((_, index) => {
      const entry = parsed.translations?.find((item) => item.i === index + 1);
      return typeof entry?.text === "string" ? entry.text.trim() : "";
    });
    return NextResponse.json({ translations }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось перевести субтитры." }, { status: 502 });
  }
}
