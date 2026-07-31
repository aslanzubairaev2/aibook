import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

  try {
    const { prompt } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "Missing prompt" }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Every other route reads the model from AI_CONFIG; this one had it pinned
    // to a 2.5 build, which meant model upgrades silently skipped it.
    const model = genAI.getGenerativeModel({ model: AI_CONFIG.model });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    return NextResponse.json({ reply: text });
  } catch (error) {
    console.error("AI Chat Error:", error);
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
