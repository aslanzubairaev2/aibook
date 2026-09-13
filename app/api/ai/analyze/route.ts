import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { buildAnalysisPrompt } from "@/lib/ai/buildAnalysisPrompt";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Keep the new separability contract predictable even when Gemini varies casing or language. */
function normalizeWordSeparability(value: unknown): "yes" | "no" | "unknown" | "" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["yes", "да", "ja", "true", "1"].includes(normalized)) return "yes";
  if (["no", "нет", "nein", "false", "0"].includes(normalized)) return "no";
  if (["unknown", "неизвестно", "не уверен", "uncertain"].includes(normalized)) return "unknown";
  return "";
}

function normalizeAnalysisSeparability(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.word) || !isRecord(value.word.verbDetails)) return value;

  const details = value.word.verbDetails;
  if (details.separability === undefined) return value;

  const separability = normalizeWordSeparability(details.separability);
  if (!separability) return value;

  return {
    ...value,
    word: {
      ...value.word,
      verbDetails: {
        ...details,
        separability,
        ...(separability === "yes" ? {} : { separablePrefix: "" }),
      },
    },
  };
}

export const maxDuration = 120;

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = await req.json() as {
    mode: "word" | "phrase" | "sentence";
    direction?: "target-to-native" | "native-to-target";
    word: string;
    text?: string;
    sentence: string;
    sentenceBefore: string;
    sentenceAfter: string;
    targetSentence?: string;
    nativeLanguage: string;
    targetLanguage: string;
    skipWord?: boolean;
    skipSentence?: boolean;
  };

  const prompt = buildAnalysisPrompt(body);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: AI_CONFIG.maxOutputTokens,
        temperature: AI_CONFIG.temperature,
      },
    });

    const result = await model.generateContent(prompt, { timeout: 110_000, signal: req.signal });
    const text = result.response.text();
    const parsed = parseJsonObject(text);
    return NextResponse.json(normalizeAnalysisSeparability(parsed));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
