import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

export const maxDuration = 60;

// The "understand this text" option is built here rather than asked of the
// model: it must exist every single time, in exactly this shape, and it must
// run in the learner's own language. Letting the model invent it produced a
// scenario that discussed the text in the language being learned — which turns
// a lesson about grammar into another listening exercise.
function analyzeScenario(nativeLanguage: string, targetLanguage: string) {
  return {
    id: "discuss",
    kind: "analyze" as const,
    label: "Разобрать текст",
    aiRole: "Преподаватель",
    userRole: "Ученик",
    prompt: `The learner wants to UNDERSTAND this text, not to practise speaking. Act as their teacher and answer every question about it — grammar ("why 'machten' here and not 'gemacht'?"), word choice, word order, register, idioms, cultural background, or what a sentence actually means. Conduct the entire conversation in ${nativeLanguage}. Quote words and sentences from the text in ${targetLanguage} when discussing them, but every explanation, question and comment of yours is in ${nativeLanguage}.`,
  };
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
    text: string;
    nativeLanguage: string;
    targetLanguage: string;
  };

  const fallback = analyzeScenario(body.nativeLanguage, body.targetLanguage);

  const systemInstruction = `You are designing live voice-conversation practice scenarios for a language learner reading the passage below. The learner's native language is "${body.nativeLanguage}" and they are learning "${body.targetLanguage}".

Look at what actually happens in the text (an interview, a dialogue between named characters, a narrative, a descriptive article, etc.) and propose 2-3 short scenarios that let the learner actively use this exact material in a live spoken roleplay — e.g. if a journalist interviews someone, one scenario casts the AI as the journalist and the learner as the interviewee (or vice versa); if it's a dialogue between two people, the AI plays one of them and the learner plays the other.

Every scenario you return is SPOKEN PRACTICE, held in ${body.targetLanguage}. Do not propose a scenario about explaining or analysing the text — the app adds that option itself.

For each scenario, write:
- "label": a short button label in ${body.nativeLanguage} (max ~6 words) describing the scenario.
- "aiRole": short phrase in ${body.nativeLanguage} naming who the AI plays.
- "userRole": short phrase in ${body.nativeLanguage} naming who the learner plays.
- "prompt": an instruction (in English, for the AI partner) describing exactly how to run this roleplay in ${body.targetLanguage}, grounded in the specific details/characters/facts from the text below.

Return ONLY valid JSON with this exact shape, ids are short slugs:
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
    const parsed = JSON.parse(result.response.text());
    const practice = Array.isArray(parsed.scenarios)
      ? parsed.scenarios
          .filter((s: unknown): s is Record<string, unknown> => typeof s === "object" && s !== null)
          .filter((s: Record<string, unknown>) => s.id !== "discuss")
          .map((s: Record<string, unknown>) => ({
            id: String(s.id ?? "practice"),
            label: String(s.label ?? "Практика"),
            aiRole: String(s.aiRole ?? ""),
            userRole: String(s.userRole ?? ""),
            prompt: String(s.prompt ?? ""),
            kind: "practice" as const,
          }))
      : [];

    // Understanding comes before performing: the analysis option leads.
    return NextResponse.json({ scenarios: [fallback, ...practice] });
  } catch (err) {
    // A failed roleplay generation must not cost the learner the ability to
    // ask about the text at all — that option needs no model call.
    console.error("live-scenarios:", err instanceof Error ? err.message : err);
    return NextResponse.json({ scenarios: [fallback] });
  }
}
