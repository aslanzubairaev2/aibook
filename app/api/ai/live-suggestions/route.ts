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
    lastModelLine: string;
    nativeLanguage: string;
    targetLanguage: string;
    scenarioContext?: string;
    kind?: "analyze" | "practice";
  };

  const contextLine = body.scenarioContext ? `\nConversation context: ${body.scenarioContext}` : "";

  // In an analysis conversation the learner is asking about the language, in
  // their own language — offering them replies to recite in the language they
  // are learning would be answering a question they did not ask.
  const systemInstruction = body.kind === "analyze"
    ? `You are helping a learner of "${body.targetLanguage}" (native language "${body.nativeLanguage}") keep a voice conversation with their teacher going. This conversation is held in ${body.nativeLanguage}: the learner asks about grammar, words and meaning, and the teacher explains.${contextLine}

The teacher just said: "${body.lastModelLine}"

Suggest exactly 4 short follow-up questions the learner could ask next, written in ${body.nativeLanguage}, varied in direction (not 4 versions of the same question) — e.g. asking why a form was chosen, how it would change in another tense, what a quoted word means, or for another example.
Keep each one short enough to say in one breath.

Return ONLY valid JSON: { "suggestions": [ { "text": "question in ${body.nativeLanguage}", "translation": "" } ] }`
    : `You are helping a learner of "${body.targetLanguage}" (native language "${body.nativeLanguage}") keep a live voice conversation going without freezing up.${contextLine}

The conversation partner just said (in ${body.targetLanguage}): "${body.lastModelLine}"

Suggest exactly 4 short, natural replies the learner could say next, in ${body.targetLanguage}, varied in direction (not 4 versions of the same answer) so the learner can pick one and either read it aloud or send it as-is.
Keep each reply short (a sentence or short phrase) and at a level a learner can pronounce comfortably.

Return ONLY valid JSON: { "suggestions": [ { "text": "reply in ${body.targetLanguage}", "translation": "translation in ${body.nativeLanguage}" } ] }`;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: AI_CONFIG.model,
      systemInstruction,
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 512,
        temperature: 0.7,
      },
    });

    const result = await model.generateContent("Generate the 4 suggestions now.");
    const rawText = result.response.text();
    const parsed = JSON.parse(rawText);
    if (!Array.isArray(parsed.suggestions) || parsed.suggestions.length === 0) {
      throw new Error("AI returned no suggestions");
    }
    return NextResponse.json({ suggestions: parsed.suggestions.slice(0, 4) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
