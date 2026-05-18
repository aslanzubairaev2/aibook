import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { buildAnalysisPrompt } from "@/lib/ai/buildAnalysisPrompt";
import { AI_CONFIG } from "@/lib/config";

const serverApiKey = process.env.GEMINI_API_KEY ?? "";

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
  // Use server env key; fall back to client-provided key in header
  const clientKey = req.headers.get("x-gemini-key") ?? "";
  const apiKey = serverApiKey || clientKey;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API key not configured. Add it in Settings." },
      { status: 500 }
    );
  }

  const body = await req.json() as {
    mode: "word" | "phrase" | "sentence";
    word: string;
    text?: string;
    sentence: string;
    sentenceBefore: string;
    sentenceAfter: string;
    nativeLanguage: string;
    targetLanguage: string;
    skipWord?: boolean;
    skipSentence?: boolean;
  };

  const prompt = buildAnalysisPrompt(body);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: AI_CONFIG.maxOutputTokens,
        temperature: AI_CONFIG.temperature,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJsonObject(text);
    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
