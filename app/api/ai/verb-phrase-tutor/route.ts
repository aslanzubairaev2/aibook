import { GoogleGenAI, Type } from "@google/genai";
import { NextResponse } from "next/server";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { parseModelJson } from "@/lib/ai/jsonResponse";
import {
  buildVerbPhraseTutorPrompt,
  type VerbPhraseTutorRequest,
} from "@/lib/ai/buildVerbPhraseTutorPrompt";

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    status: { type: Type.STRING, enum: ["prompt", "retry", "question", "accepted"] },
    reply: { type: Type.STRING },
    hint: { type: Type.STRING },
    correction: {
      type: Type.OBJECT,
      properties: {
        target: { type: Type.STRING },
        translation: { type: Type.STRING },
        explanation: { type: Type.STRING },
      },
      required: ["target", "translation", "explanation"],
    },
    challenge: {
      type: Type.OBJECT,
      properties: { nativePrompt: { type: Type.STRING } },
      required: ["nativePrompt"],
    },
    suggestions: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["status", "reply"],
} as const;

export const maxDuration = 120;

function text(value: unknown, max = 900): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseReply(raw: string, request: VerbPhraseTutorRequest) {
  const parsed = parseModelJson(raw);
  const source = parsed.ok && parsed.value && typeof parsed.value === "object"
    ? parsed.value as Record<string, unknown>
    : {};
  const rawStatus = text(source.status, 20);
  const status = ["prompt", "retry", "question", "accepted"].includes(rawStatus)
    ? rawStatus as "prompt" | "retry" | "question" | "accepted"
    : request.action === "start" ? "prompt" : "question";
  const correctionSource = source.correction && typeof source.correction === "object"
    ? source.correction as Record<string, unknown>
    : {};
  const challengeSource = source.challenge && typeof source.challenge === "object"
    ? source.challenge as Record<string, unknown>
    : {};
  const suggestions = Array.isArray(source.suggestions)
    ? source.suggestions.map((item) => text(item, 90)).filter(Boolean).slice(0, 3)
    : [];

  const parsedReply = text(source.reply, 1400);
  const fallbackReply = request.action === "hint" || request.action === "question"
    ? "Сформулируй вопрос точнее — я отвечу по существу."
    : "";

  return {
    status,
    reply: parsedReply || fallbackReply,
    ...(text(source.hint, 360) ? { hint: text(source.hint, 360) } : {}),
    ...(text(correctionSource.target, 500) || text(correctionSource.translation, 500) || text(correctionSource.explanation, 700)
      ? {
          correction: {
            target: text(correctionSource.target, 500),
            translation: text(correctionSource.translation, 500),
            explanation: text(correctionSource.explanation, 700),
          },
        }
      : {}),
    ...(text(challengeSource.nativePrompt, 360)
      ? { challenge: { nativePrompt: text(challengeSource.nativePrompt, 360) } }
      : {}),
    ...(suggestions.length ? { suggestions } : {}),
  };
}

/** Turn an SDK/transport error into something a learner can actually read. */
function describeThrow(error: unknown): { error: string; status: number } {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();
  if (lower.includes("api key") || lower.includes("api_key") || lower.includes("401") || lower.includes("403")) {
    return { error: "Ключ Gemini не принят. Проверьте его в настройках.", status: 403 };
  }
  if (lower.includes("429") || lower.includes("quota") || lower.includes("resource_exhausted")) {
    return { error: "Google временно ограничил запросы (превышена квота). Подождите минуту и попробуйте снова.", status: 429 };
  }
  if (lower.includes("503") || lower.includes("unavailable") || lower.includes("overloaded")) {
    return { error: "Сервис Gemini сейчас перегружен. Подождите минуту и нажмите «Повторить».", status: 503 };
  }
  if (lower.includes("timeout") || lower.includes("aborted") || lower.includes("fetch failed")) {
    return { error: "Не дождались ответа модели. Проверьте связь и попробуйте ещё раз.", status: 504 };
  }
  if (lower.includes("not found") || lower.includes("404")) {
    return { error: `Модель ${AI_CONFIG.discussModel} недоступна для этого ключа.`, status: 502 };
  }
  return { error: raw || "Не удалось получить ответ ИИ.", status: 500 };
}

function hasUsableReply(reply: ReturnType<typeof parseReply>, action: VerbPhraseTutorRequest["action"]): boolean {
  if (action === "start") return Boolean(reply.challenge?.nativePrompt);
  if (reply.status === "accepted") return true;
  return Boolean(
    reply.reply
    || reply.hint
    || reply.correction?.target
    || reply.correction?.translation
    || reply.correction?.explanation,
  );
}

export async function POST(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Access Denied" }, { status: 403 });
  }

  let body: VerbPhraseTutorRequest;
  try {
    body = await req.json() as VerbPhraseTutorRequest;
  } catch {
    return NextResponse.json({ error: "Некорректный запрос." }, { status: 400 });
  }

  if (!body.lemma && !body.headword) {
    return NextResponse.json({ error: "Не указан глагол." }, { status: 400 });
  }
  if (!body.targetLanguage || !body.nativeLanguage) {
    return NextResponse.json({ error: "Не указаны языки тренировки." }, { status: 400 });
  }

  const prompt = buildVerbPhraseTutorPrompt({
    ...body,
    history: (body.history ?? []).slice(-12).map((message) => ({
      role: message.role === "model" ? "model" : "user",
      text: text(message.text, 1200),
    })),
    message: text(body.message, 1000),
  });

  try {
    const ai = new GoogleGenAI({ apiKey });
    const result = await ai.models.generateContent({
      model: AI_CONFIG.discussModel,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        httpOptions: { timeout: 110_000 },
        abortSignal: req.signal,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA as never,
        maxOutputTokens: 1800,
        temperature: 0.35,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let raw = "";
    try { raw = result.text ?? ""; } catch { raw = ""; }
    const parsedReply = parseReply(raw, body);
    if (!hasUsableReply(parsedReply, body.action)) {
      return NextResponse.json({ error: "ИИ не вернул проверку фразы. Попробуйте ещё раз." }, { status: 502 });
    }
    return NextResponse.json(parsedReply);
  } catch (error) {
    const failure = describeThrow(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
