import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { buildVerbFormsPrompt, type VerbFormsPromptParams } from "@/lib/ai/buildVerbFormsPrompt";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { parseModelJson } from "@/lib/ai/jsonResponse";

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = (await req.json()) as VerbFormsPromptParams;
  if (!body.lemma && !body.headword) {
    return NextResponse.json({ error: "Не указан глагол." }, { status: 400 });
  }
  const prompt = buildVerbFormsPrompt(body);

  try {
    const response = await new GoogleGenAI({ apiKey }).models.generateContent({
      model: AI_CONFIG.dictionaryModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            praeteritum: { type: Type.STRING },
            partizip2: { type: Type.STRING },
            hilfsverb: { type: Type.STRING },
            trennbar: { type: Type.STRING },
          },
          required: ["praeteritum", "partizip2", "hilfsverb", "trennbar"],
        },
        maxOutputTokens: 256,
        thinkingConfig: { thinkingLevel: AI_CONFIG.dictionaryThinkingLevel as ThinkingLevel },
      },
    });
    const text = response.text ?? "";
    const parsedResult = parseModelJson(text);
    if (!parsedResult.ok) throw new Error("AI returned invalid JSON");
    const parsed = parsedResult.value as Record<string, unknown>;

    const forms: Record<string, string> = {};
    for (const key of ["praeteritum", "partizip2", "hilfsverb", "trennbar"]) {
      const value = String(parsed[key] ?? "").trim();
      if (value) forms[key] = value.slice(0, 120);
    }

    if (!forms.praeteritum || !forms.partizip2 || !["haben", "sein"].includes(forms.hilfsverb ?? "") || !["да", "нет"].includes(forms.trennbar ?? "")) {
      return NextResponse.json({ error: "ИИ вернул неполный набор форм глагола." }, { status: 502 });
    }
    return NextResponse.json({ forms, model: AI_CONFIG.dictionaryModel });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
