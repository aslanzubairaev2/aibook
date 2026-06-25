import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Access Denied";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  const body = await req.json() as {
    text: string;
    nativeLanguage: string;
    targetLanguage: string;
  };

  const systemInstruction = `You are designing live voice-conversation practice scenarios for a language learner reading the passage below. The learner's native language is "${body.nativeLanguage}" and they are learning "${body.targetLanguage}".

Look at what actually happens in the text (an interview, a dialogue between named characters, a narrative, a descriptive article, etc.) and propose 2-3 short scenarios that let the learner actively use this exact material in a live spoken roleplay — e.g. if a journalist interviews someone, one scenario casts the AI as the journalist and the learner as the interviewee (or vice versa); if it's a dialogue between two people, the AI plays one of them and the learner plays the other.

For each scenario, write:
- "label": a short button label in ${body.nativeLanguage} (max ~6 words) describing the scenario.
- "aiRole": short phrase in ${body.nativeLanguage} naming who the AI plays.
- "userRole": short phrase in ${body.nativeLanguage} naming who the learner plays.
- "prompt": an instruction (in English, for the AI partner) describing exactly how to run this roleplay in ${body.targetLanguage}, grounded in the specific details/characters/facts from the text below.

Always also include exactly one fallback scenario with "id": "discuss", "label" something like "Обсудить текст", "aiRole" "Собеседник", "userRole" "Ты", and a "prompt" instructing the AI to have a free-form spoken discussion in ${body.targetLanguage} about the content of the text (asking the learner's opinion, clarifying vocabulary, etc.), not a roleplay.

Return ONLY valid JSON with this exact shape, ids other than "discuss" can be short slugs:
{ "scenarios": [ { "id": "string", "label": "string", "aiRole": "string", "userRole": "string", "prompt": "string" } ] }

Text:
"""
${body.text.slice(0, 6000)}
"""`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: AI_CONFIG.maxOutputTokens,
        temperature: 0.5,
      },
    });

    const result = await model.generateContent("Generate the scenarios now.");
    const rawText = result.response.text();
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed.scenarios) || parsed.scenarios.length === 0) {
      throw new Error("AI returned no scenarios");
    }
    return NextResponse.json({ scenarios: parsed.scenarios });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
