import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { buildFastWordPrompt, parseFastWordJson } from "@/lib/ai/fastWord";
import { sbGetFastWordCache, sbSaveFastWordCache } from "@/lib/db/supabase";

const FAST_WORD_MODEL = "gemini-3.1-flash-lite";

export async function POST(req: Request) {
  const body = await req.json() as { word?: string; sentence?: string; nativeLanguage?: string; targetLanguage?: string };
  const word = body.word?.trim();
  if (!word || !body.nativeLanguage || !body.targetLanguage) {
    return NextResponse.json({ error: "Word and languages are required." }, { status: 400 });
  }

  const cachedPromise = sbGetFastWordCache(word, body.targetLanguage, body.nativeLanguage);
  const clientKey = req.headers.get("x-gemini-key")?.trim() || "";
  const cached = await cachedPromise;
  if (cached) return NextResponse.json(cached, { headers: { "Cache-Control": "private, max-age=300" } });

  let apiKey: string;
  try {
    apiKey = clientKey || await getApiKeyForRequest(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Access Denied" }, { status: 403 });
  }

  try {
    const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
      model: FAST_WORD_MODEL,
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 128, temperature: 0.1 },
    });
    const result = await model.generateContent(buildFastWordPrompt({
      word,
      sentence: body.sentence?.trim() || word,
      nativeLanguage: body.nativeLanguage,
      targetLanguage: body.targetLanguage,
    }));
    const info = parseFastWordJson(result.response.text(), word);
    void sbSaveFastWordCache(word, body.targetLanguage, body.nativeLanguage, info);
    return NextResponse.json(info, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Fast word lookup failed" }, { status: 500 });
  }
}
