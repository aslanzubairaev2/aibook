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
    prompt: `The learner wants to UNDERSTAND this text, not to practise speaking. Act as their teacher and answer every question about it — grammar ("why 'machten' here and not 'gemacht'?"), word choice, word order, register, idioms, cultural background, or what a sentence actually means. Conduct the entire conversation in ${nativeLanguage}. Quote words and sentences from the text in ${targetLanguage} when discussing them, but every explanation, question and comment of yours is in ${nativeLanguage}. If the learner asks you to switch to questioning them about the text instead, do it — do not tell them that is not your job.`,
  };
}

/**
 * The other half of "working through a text": being asked about it.
 *
 * Built here rather than left to the model for the same reason as the one
 * above — it must exist every time, in this exact shape. And it has to be its
 * own option rather than something the learner talks the tutor into: asked to
 * put questions, a tutor whose instruction says "explain what the learner does
 * not understand" would reply that it is not here to test them. That refusal is
 * the tutor doing its job correctly for a job the learner did not ask for.
 */
function quizScenario(nativeLanguage: string, targetLanguage: string) {
  return {
    id: "quiz",
    kind: "quiz" as const,
    label: "Задать вопросы по тексту",
    aiRole: "Экзаменатор",
    userRole: "Отвечает по памяти",
    prompt: `You question the learner about this text; they answer from memory. You ask, they answer — never the other way round, and never turn this into an explanation of the text unless they explicitly ask for one.

How to run it:
- Ask one question at a time in ${targetLanguage} and wait for the answer. Never ask two at once, and never answer your own question.
- Work through the text in order: start with what happened and who is in it, then details, then the "why" questions that need an opinion. Do not read the text out.
- After each answer, say in one short sentence whether it is right. If it is wrong or incomplete, say what the text actually said, then move on — do not start a lesson.
- Accept an answer that is right in substance even if the ${targetLanguage} is clumsy. Correct the language only when the mistake makes the answer hard to understand, and then by repeating the sentence properly rather than by explaining a rule.
- If the learner cannot remember, give one hint; if they still cannot, tell them the answer and go to the next question.
- The learner may answer, or ask for a hint, in ${nativeLanguage}. Accept that, and keep asking in ${targetLanguage}.`,
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

  // The two ways of working through a text that need no model call: having it
  // explained, and being asked about it.
  const built = [
    analyzeScenario(body.nativeLanguage, body.targetLanguage),
    quizScenario(body.nativeLanguage, body.targetLanguage),
  ];

  const systemInstruction = `You are designing live voice-conversation practice scenarios for a language learner reading the passage below. The learner's native language is "${body.nativeLanguage}" and they are learning "${body.targetLanguage}".

Look at what actually happens in the text (an interview, a dialogue between named characters, a narrative, a descriptive article, etc.) and propose 2-3 short scenarios that let the learner actively use this exact material in a live spoken roleplay — e.g. if a journalist interviews someone, one scenario casts the AI as the journalist and the learner as the interviewee (or vice versa); if it's a dialogue between two people, the AI plays one of them and the learner plays the other.

Every scenario you return is SPOKEN PRACTICE, held in ${body.targetLanguage}. Do not propose a scenario about explaining or analysing the text, and do not propose one where you quiz the learner on what the text said — the app adds both of those itself.

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
          .filter((s: Record<string, unknown>) => s.id !== "discuss" && s.id !== "quiz")
          .map((s: Record<string, unknown>) => ({
            id: String(s.id ?? "practice"),
            label: String(s.label ?? "Практика"),
            aiRole: String(s.aiRole ?? ""),
            userRole: String(s.userRole ?? ""),
            prompt: String(s.prompt ?? ""),
            kind: "practice" as const,
          }))
      : [];

    // Understanding comes before performing: the two text-work options lead.
    return NextResponse.json({ scenarios: [...built, ...practice] });
  } catch (err) {
    // A failed roleplay generation must not cost the learner the ability to
    // ask about the text at all — that option needs no model call.
    console.error("live-scenarios:", err instanceof Error ? err.message : err);
    return NextResponse.json({ scenarios: built });
  }
}
