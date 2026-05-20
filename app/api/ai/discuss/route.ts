import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import type { DiscussMessage } from "@/lib/types";

const serverApiKey = process.env.GEMINI_API_KEY ?? "";

function messageText(message: DiscussMessage) {
  return message.text || message.contentParts?.map((part) => part.text).join("") || "";
}

export async function POST(req: Request) {
  const clientKey = req.headers.get("x-gemini-key") ?? "";
  const apiKey = serverApiKey || clientKey;

  if (!apiKey) {
    return NextResponse.json(
      { error: "Gemini API key not configured. Add it in Settings." },
      { status: 500 },
    );
  }

  const body = await req.json() as {
    mode: "word" | "phrase" | "sentence";
    selectedText: string;
    sentence: string;
    sentenceBefore?: string;
    sentenceAfter?: string;
    nativeLanguage: string;
    targetLanguage: string;
    history: DiscussMessage[];
    message: string;
  };

  const context =
    body.mode === "sentence"
      ? `Previous sentence: "${body.sentenceBefore || ""}"\nSelected sentence: "${body.selectedText}"\nNext sentence: "${body.sentenceAfter || ""}"`
      : body.mode === "phrase"
        ? `Selected phrase: "${body.selectedText}"\nCurrent sentence: "${body.sentence}"`
        : `Selected word: "${body.selectedText}"\nCurrent sentence: "${body.sentence}"`;

  const formattedHistory = body.history.map((message) => ({
    role: message.role === "model" ? "model" : "user",
    parts: [{ text: messageText(message) }],
  }));

  const systemInstruction = `You are a friendly language tutor. The student is learning "${body.targetLanguage}" and speaks "${body.nativeLanguage}".

Discuss the selected ${body.mode} and answer in ${body.nativeLanguage}. Be concise but useful.

Context:
${context}

Return ONLY valid JSON with this exact shape:
{
  "role": "model",
  "contentParts": [
    { "type": "text", "text": "plain explanation in ${body.nativeLanguage}" },
    { "type": "learning", "text": "word or phrase in ${body.targetLanguage}", "translation": "translation in ${body.nativeLanguage}" }
  ]
}

Use "learning" parts for any ${body.targetLanguage} words, phrases, examples, or sentences so the app can make them clickable and speakable.
Every "learning" part MUST include a clear "translation" in ${body.nativeLanguage}. If you give examples, each example must be a learning part with translation.
Do not suggest replacing source text. Do not include markdown.`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: AI_CONFIG.maxOutputTokens,
        temperature: 0.6,
      },
    });

    const result = await model.generateContent({
      contents: [
        ...formattedHistory,
        { role: "user", parts: [{ text: body.message }] },
      ],
    });
    const rawText = result.response.text();
    let parsed: any;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // AI returned invalid JSON — wrap raw text as a plain message
      return NextResponse.json({
        role: "model",
        contentParts: [{ type: "text", text: rawText || "No response." }],
      });
    }

    if (!Array.isArray(parsed.contentParts)) {
      return NextResponse.json({
        role: "model",
        contentParts: [{ type: "text", text: rawText || "No response." }],
      });
    }

    return NextResponse.json({
      role: "model",
      contentParts: parsed.contentParts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
