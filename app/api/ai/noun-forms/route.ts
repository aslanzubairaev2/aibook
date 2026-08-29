import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { buildNounFormsPrompt, type NounFormsPromptParams } from "@/lib/ai/buildNounFormsPrompt";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

const GENDERS = new Set(["m", "f", "n", "pl"]);
const ARTICLE_FOR: Record<string, string> = { m: "der", f: "die", n: "das", pl: "die" };

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

  const body = (await req.json()) as NounFormsPromptParams;
  if (!body.lemma && !body.headword) {
    return NextResponse.json({ error: "Не указано существительное." }, { status: 400 });
  }
  const prompt = buildNounFormsPrompt(body);

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
    const parsed = parseJsonObject(result.response.text()) as Record<string, unknown>;

    const gender = String(parsed.gender ?? "").trim().toLowerCase();
    const safeGender = GENDERS.has(gender) ? gender : "";
    // The article is what the learner is drilled on, so it must agree with the
    // gender rather than being whatever the model happened to type next to it.
    const article = safeGender
      ? ARTICLE_FOR[safeGender]
      : String(parsed.article ?? "").trim().slice(0, 20).toLowerCase();
    const plural = String(parsed.plural ?? "").trim().slice(0, 120);

    return NextResponse.json({ noun: { gender: safeGender, article, plural } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
