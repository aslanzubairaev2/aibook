import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { parseModelJson } from "@/lib/ai/jsonResponse";
import { buildCardVerifyPrompt, normalizeVerifyResult, sanitizeVerifyRequest } from "@/lib/ai/cardVerify";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const VERIFY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    verdict: { type: Type.STRING },
    front: { type: Type.STRING },
    back: { type: Type.STRING },
    changes: { type: Type.ARRAY, items: { type: Type.STRING } },
    note: { type: Type.STRING },
    question: { type: Type.STRING },
  },
  // Every field is required: left optional, the model dropped `back` from a fix and
  // used `question` as a scratchpad. Unused ones are asked for as empty values.
  required: ["verdict", "front", "back", "changes", "note", "question"],
  propertyOrdering: ["verdict", "question", "front", "back", "changes", "note"],
};

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const request = sanitizeVerifyRequest(await req.json().catch(() => null));
  if (!request) {
    return NextResponse.json({ error: "У карточки должны быть лицевая и обратная стороны." }, { status: 400 });
  }

  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      // The stronger model on purpose: the lighter one answered an ambiguous card
      // ("Kiefer" = «кость») with a confident guess instead of the question it
      // was told to ask. Checked live on both before choosing.
      model: AI_CONFIG.dictionaryModel,
      contents: [{ role: "user", parts: [{ text: buildCardVerifyPrompt(request) }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: VERIFY_SCHEMA as never,
        maxOutputTokens: 2048,
        temperature: 0.1,
        thinkingConfig: { thinkingBudget: 1024 },
        abortSignal: req.signal,
      },
    });

    let raw = "";
    try { raw = response.text ?? ""; } catch { raw = ""; }
    const parsed = parseModelJson(raw);
    const result = parsed.ok ? normalizeVerifyResult(parsed.value, request.card) : null;
    if (!result) {
      return NextResponse.json({ error: "Модель вернула непонятный ответ. Попробуйте ещё раз." }, { status: 502 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
