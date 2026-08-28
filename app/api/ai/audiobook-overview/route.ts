import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { sbGetCachedAudiobookOverview, sbSaveCachedAudiobookOverview } from "@/lib/db/audiobookOverviewCache";

export const dynamic = "force-dynamic";

function buildPrompt(title: string, author: string, language: string): string {
  return [
    `Аудиокнига: "${title}", автор: ${author}, язык: ${language}.`,
    "Сделай очень короткую карточку для изучающего язык без спойлеров, без markdown и без спецсимволов.",
    "Строго 4 строки:",
    "О чем: одно короткое предложение.",
    "Жанр: 2-4 слова.",
    "Язык: примерный уровень A1-C2 и темп/сложность речи.",
    "Кому: кому подойдет для аудирования.",
  ].join("\n");
}

// POST /api/ai/audiobook-overview
// Body: { audiobookId, title, author, language }
//
// The card is the same for every reader of a given book, so it is cached in
// Supabase keyed on the catalog id: the first person to open a book pays for
// the Gemini call, everyone after — on any device — reads the cached row.
export async function POST(req: Request) {
  const body = await req.json() as {
    audiobookId?: string;
    title?: string;
    author?: string;
    language?: string;
  };

  const audiobookId = (body.audiobookId ?? "").trim();
  const title = (body.title ?? "").trim();
  const author = (body.author ?? "Неизвестный автор").trim();
  const language = (body.language ?? "").trim();

  if (!audiobookId || !title) {
    return NextResponse.json({ error: "Missing audiobookId or title" }, { status: 400 });
  }

  const cached = await sbGetCachedAudiobookOverview(audiobookId);
  if (cached) {
    return NextResponse.json({ review: cached, fromCache: true });
  }

  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Access Denied" }, { status: 403 });
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: AI_CONFIG.model });
    const result = await model.generateContent(buildPrompt(title, author, language));
    const review = result.response.text();

    // Best-effort: a failed cache write costs a repeat charge later, never this request.
    void sbSaveCachedAudiobookOverview(audiobookId, title, author, language, review);

    return NextResponse.json({ review, fromCache: false });
  } catch (error) {
    console.error("Audiobook overview error:", error);
    const msg = error instanceof Error ? error.message : "Internal Server Error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
