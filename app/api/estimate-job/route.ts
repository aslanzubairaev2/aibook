import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { normalizeLanguageCode } from "@/lib/ttsProviders";

export const dynamic = "force-dynamic";

// POST /api/estimate-job
// Body: { paragraphs: string[], kind: "translate" | "audio", lang, voice }
//
// Sharpens the quote shown before a paid job runs, in the two ways the client
// cannot do for itself:
//
//   * the exact input token count, from the model's own tokenizer, instead of
//     dividing the character count by four;
//   * how many paragraphs already have audio cached, so work that is already
//     paid for is excluded from the price rather than quoted again.
//
// Counting tokens is not billed, so this call is free.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    paragraphs?: unknown;
    kind?: string;
    lang?: string;
    voice?: string;
  };

  const paragraphs = Array.isArray(body.paragraphs)
    ? body.paragraphs.filter((p): p is string => typeof p === "string")
    : [];
  if (paragraphs.length === 0) {
    return NextResponse.json({ error: "Нечего оценивать." }, { status: 400 });
  }

  const text = paragraphs.join("\n");
  let inputTokens: number | null = null;

  try {
    const apiKey = await getApiKeyForRequest(req);
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: AI_CONFIG.model });
    const { totalTokens } = await model.countTokens(text);
    inputTokens = totalTokens;
  } catch (err) {
    // The estimate degrades to the client's character-based guess rather than
    // blocking the job — a rough quote beats no quote.
    console.warn("estimate-job countTokens:", err instanceof Error ? err.message : err);
  }

  // How much of the narration is already paid for.
  let cachedCount = 0;
  if (body.kind === "audio" && supabaseAdmin) {
    const lang = normalizeLanguageCode(body.lang ?? "de");
    const voice = body.voice ?? "Algenib";
    const candidates = paragraphs.map((p) => p.slice(0, 2000)).filter((p) => p.trim().length > 0);

    const { data } = await supabaseAdmin
      .from("ai_tts_cache")
      .select("text")
      .eq("lang", lang)
      .eq("voice_name", voice)
      .in("text", candidates);

    const cached = new Set((data ?? []).map((row) => row.text as string));
    cachedCount = candidates.filter((p) => cached.has(p)).length;
  }

  return NextResponse.json({ inputTokens, cachedCount });
}
