import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { buildVerbFormsPrompt, type VerbFormsPromptParams } from "@/lib/ai/buildVerbFormsPrompt";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

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
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 256,
        temperature: AI_CONFIG.temperature,
      },
    });

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = parseJsonObject(text) as Record<string, unknown>;

    const forms: Record<string, string> = {};
    for (const key of ["praeteritum", "partizip2", "hilfsverb", "trennbar"]) {
      const value = String(parsed[key] ?? "").trim();
      if (value) forms[key] = value.slice(0, 120);
    }

    return NextResponse.json({ forms });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
