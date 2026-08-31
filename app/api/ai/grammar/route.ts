import { GoogleGenerativeAI, SchemaType, type Schema } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { buildGrammarPrompt, type GrammarPromptParams } from "@/lib/ai/buildGrammarPrompt";
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

// The full verb view requires a 4×3 (tense × polarity) matrix of 6-person
// arrays. The model does not always comply with that shape from prompt text
// alone (it sometimes just returns "sections" instead, like the brief view),
// so we force it structurally here rather than rely on the wording.
const personSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    form: { type: SchemaType.STRING },
    native: { type: SchemaType.STRING },
  },
  required: ["form", "native"],
};

const verbMatrixResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    word: { type: SchemaType.STRING },
    lemma: { type: SchemaType.STRING },
    language: { type: SchemaType.STRING },
    partOfSpeech: { type: SchemaType.STRING },
    kind: { type: SchemaType.STRING },
    detail: { type: SchemaType.STRING },
    matrix: {
      type: SchemaType.OBJECT,
      properties: {
        rowLabels: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        colLabels: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
        cells: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.ARRAY,
            items: { type: SchemaType.ARRAY, items: personSchema },
          },
        },
      },
      required: ["rowLabels", "colLabels", "cells"],
    },
    languageWarning: { type: SchemaType.STRING },
  },
  required: ["word", "lemma", "language", "partOfSpeech", "kind", "detail", "matrix"],
};

// Reject a matrix that is missing rows/columns/persons or has empty forms —
// this is what let a broken "full" response through and get cached as if it
// were a real conjugation table.
function isValidVerbMatrix(matrix: unknown): boolean {
  if (!matrix || typeof matrix !== "object") return false;
  const m = matrix as Record<string, unknown>;
  return (
    Array.isArray(m.rowLabels) && m.rowLabels.length === 4 &&
    Array.isArray(m.colLabels) && m.colLabels.length === 3 &&
    Array.isArray(m.cells) && m.cells.length === 4 &&
    m.cells.every((row) =>
      Array.isArray(row) && row.length === 3 &&
      row.every((col) =>
        // Exactly 6, not merely non-empty: the prompt requires all 6 core
        // persons for the full matrix (no impersonal-verb exception there,
        // unlike "brief"), and the client labels each cell by fixed position
        // (CONJUGATION_PRONOUNS[i] in VerbsQuiz.tsx) with no per-person marker
        // in the schema to check against. A model that returns fewer — say,
        // one form for an impersonal verb like "regnen" — would otherwise
        // pass validation and get mislabeled "ich" at position 0 instead of
        // the "er/sie/es" it actually meant.
        Array.isArray(col) && col.length === 6 &&
        col.every((p) => !!p && typeof p === "object" && typeof (p as { form?: unknown }).form === "string" && (p as { form: string }).form.trim())
      )
    )
  );
}

// The full verb matrix is the slowest shape this route generates; bounding
// the invocation means a stuck one gets killed and freed rather than sitting
// on the platform indefinitely after the client has already given up on it
// (see `fetchWithTimeout` in lib/net/freshFetch.ts).
export const maxDuration = 120;

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = (await req.json()) as GrammarPromptParams;
  const prompt = buildGrammarPrompt(body);
  const isVerbFull = body.detail === "full" && body.posTag === "verb";

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      generationConfig: {
        responseMimeType: "application/json",
        ...(isVerbFull ? { responseSchema: verbMatrixResponseSchema } : {}),
        // The full verb view is a 4×3 Petrov matrix (~72 phrases) — needs room.
        maxOutputTokens: body.detail === "full" ? 8192 : 1536,
        temperature: AI_CONFIG.temperature,
      },
    });

    const result = await model.generateContent(prompt, { timeout: 110_000, signal: req.signal });
    const text = result.response.text();
    const parsed = parseJsonObject(text);

    if (isVerbFull && !isValidVerbMatrix(parsed.matrix)) {
      throw new Error("AI не вернул полную таблицу спряжения — попробуйте ещё раз");
    }

    return NextResponse.json(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
