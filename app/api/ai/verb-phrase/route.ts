import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { buildVerbPhrasePrompt, type VerbPhrasePromptParams } from "@/lib/ai/buildVerbPhrasePrompt";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

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

export const maxDuration = 120;

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = (await req.json()) as VerbPhrasePromptParams;
  if (!body.lemma && !body.headword) {
    return NextResponse.json({ error: "Не указан глагол." }, { status: 400 });
  }
  const prompt = buildVerbPhrasePrompt(body);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 256,
        temperature: AI_CONFIG.temperature,
      },
    });

    const result = await model.generateContent(prompt, { timeout: 110_000, signal: req.signal });
    const text = result.response.text();
    const parsed = parseJsonObject(text) as Record<string, unknown>;

    const example = String(parsed.example ?? "").trim().slice(0, 300);
    const exampleTranslation = String(parsed.exampleTranslation ?? "").trim().slice(0, 300);
    if (!example || !exampleTranslation) {
      throw new Error(`ИИ не смог составить пример для «${body.lemma || body.headword}»`);
    }

    return NextResponse.json({ example, exampleTranslation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
