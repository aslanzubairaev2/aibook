import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = await req.json() as {
    text: string;
    sourceLanguage: string;
    targetLanguage: string;
  };

  if (!body.text?.trim()) {
    return NextResponse.json({ translation: "" });
  }

  const systemInstruction = `Translate the given text from "${body.sourceLanguage}" to "${body.targetLanguage}". Return ONLY the translation, no quotes, no notes, no markdown.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      systemInstruction,
      generationConfig: {
        maxOutputTokens: 256,
        temperature: 0.1,
      },
    });

    const result = await model.generateContent(body.text);
    const translation = result.response.text().trim();
    return NextResponse.json({ translation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
