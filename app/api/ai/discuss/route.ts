// The chat behind "Обсудить с AI".
//
// The discussion uses the same fast model as the rest of the app, but asks for
// more than prose. The answer carries the follow-up chips and the buttons
// that open the app's own grammar tables, so the chat can offer "Спряжение
// aufräumen" instead of pasting a paradigm into a message bubble.

import { GoogleGenAI, Type, type GenerateContentResponse } from "@google/genai";
import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import type { AiMode, DiscussMessage, DiscussWordProfile } from "@/lib/types";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { parseModelJson } from "@/lib/ai/jsonResponse";
import { buildDiscussSystemPrompt, parseDiscussReply } from "@/lib/ai/buildDiscussPrompt";

/** Points the SDK at a stand-in service in tests; unset in production. */
const BASE_URL = process.env.GEMINI_API_BASE_URL;

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    contentParts: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          type: { type: Type.STRING },
          text: { type: Type.STRING },
          translation: { type: Type.STRING },
        },
        required: ["type", "text"],
      },
    },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
    actions: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING },
          label: { type: Type.STRING },
          word: { type: Type.STRING },
        },
        required: ["kind", "label", "word"],
      },
    },
  },
  required: ["contentParts"],
} as const;

function messageText(message: DiscussMessage) {
  return message.text || message.contentParts?.map((part) => part.text).join("") || "";
}

/**
 * Remembers, for the life of the server process, that the configured discussion
 * model is not reachable with the key in use — so a learner whose key predates
 * it pays the 404 round-trip once instead of on every message.
 */
let discussModelUnavailable = false;

function looksUnavailable(err: unknown): boolean {
  const raw = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    raw.includes("404") ||
    raw.includes("not found") ||
    raw.includes("not_found") ||
    raw.includes("is not supported") ||
    raw.includes("unsupported")
  );
}

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = await req.json() as {
    mode: AiMode;
    selectedText: string;
    sentence: string;
    sentenceBefore?: string;
    sentenceAfter?: string;
    nativeLanguage: string;
    targetLanguage: string;
    learnerLevel?: string;
    wordProfile?: DiscussWordProfile;
    homeworkContext?: { instruction: string; items: string[] };
    history: DiscussMessage[];
    message: string;
  };

  const systemInstruction = buildDiscussSystemPrompt({
    mode: body.mode,
    selectedText: body.selectedText,
    sentence: body.sentence,
    sentenceBefore: body.sentenceBefore,
    sentenceAfter: body.sentenceAfter,
    nativeLanguage: body.nativeLanguage,
    targetLanguage: body.targetLanguage,
    learnerLevel: body.learnerLevel,
    wordProfile: body.wordProfile,
    homeworkContext: body.homeworkContext,
  });

  const contents = [
    ...body.history.map((message) => ({
      role: message.role === "model" ? "model" : "user",
      parts: [{ text: messageText(message) }],
    })),
    { role: "user", parts: [{ text: body.message }] },
  ];

  const ai = new GoogleGenAI(BASE_URL ? { apiKey, httpOptions: { baseUrl: BASE_URL } } : { apiKey });

  const call = (model: string) => ai.models.generateContent({
    model,
    contents,
    config: {
      systemInstruction,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA as never,
      maxOutputTokens: AI_CONFIG.discussMaxOutputTokens,
      temperature: 0.7,
      // The depth here comes from the instructions, not from a thinking
      // budget — and in a chat the learner is waiting, while a budget spent
      // thinking comes out of the same ceiling as the answer and truncates it.
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  let response: GenerateContentResponse;
  try {
    response = discussModelUnavailable
      ? await call(AI_CONFIG.model)
      : await call(AI_CONFIG.discussModel);
  } catch (err) {
    if (discussModelUnavailable || !looksUnavailable(err)) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
    // The key cannot reach the discussion model: keep the chat working on the
    // model the rest of the app already uses.
    discussModelUnavailable = true;
    try {
      response = await call(AI_CONFIG.model);
    } catch (fallbackErr) {
      const msg = fallbackErr instanceof Error ? fallbackErr.message : "Unknown error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // `.text` is a getter that throws on a blocked response.
  let rawText = "";
  try {
    rawText = response.text ?? "";
  } catch {
    rawText = "";
  }

  const parsed = parseModelJson(rawText);
  return NextResponse.json(parseDiscussReply(parsed.ok ? parsed.value : null, rawText));
}
