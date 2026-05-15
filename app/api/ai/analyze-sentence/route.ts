import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { buildSentencePrompt } from "@/lib/ai/buildSentencePrompt";
import { AI_CONFIG } from "@/lib/config";

const serverApiKey = process.env.GEMINI_API_KEY ?? "";

export async function POST(req: Request) {
  const clientKey = req.headers.get("x-gemini-key") ?? "";
  const apiKey = serverApiKey || clientKey;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API key not configured. Add it in Settings." },
      { status: 500 }
    );
  }

  const body = await req.json() as {
    word: string;
    sentence: string;
    sentenceBefore: string;
    sentenceAfter: string;
    nativeLanguage: string;
    targetLanguage: string;
  };

  const prompt = buildSentencePrompt(body);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: Math.floor(AI_CONFIG.maxOutputTokens / 2), // Require less tokens
        temperature: AI_CONFIG.temperature,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = JSON.parse(text);
    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
