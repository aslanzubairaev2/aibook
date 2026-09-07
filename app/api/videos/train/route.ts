import { GoogleGenAI, Type } from "@google/genai";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { AI_CONFIG } from "@/lib/config";
import { trainingInstruction, validateTrainingRequest } from "@/lib/videos/training";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let apiKey: string;
  try { apiKey = await getApiKeyForRequest(request); }
  catch { return Response.json({ error: "Войдите в аккаунт с доступом к ИИ или укажите Gemini API ключ в настройках." }, { status: 403 }); }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 700000) return Response.json({ error: "Текст слишком большой для тренировки целиком." }, { status: 413 });
    body = JSON.parse(raw);
  } catch { return Response.json({ error: "Некорректный запрос." }, { status: 400 }); }
  if (!validateTrainingRequest(body)) return Response.json({ error: "Не удалось прочитать реплики или параметры тренировки. Текст должен содержать не более 500 000 символов." }, { status: 400 });
  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: AI_CONFIG.model,
      contents: JSON.stringify(body),
      config: {
        systemInstruction: trainingInstruction(body),
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties: {
          prompt: { type: Type.STRING }, feedback: { type: Type.STRING }, correct: { type: Type.BOOLEAN },
        }, required: ["prompt", "feedback", "correct"] },
        temperature: 0.2, maxOutputTokens: 2048,
        httpOptions: { timeout: 100000 }, abortSignal: request.signal,
      },
    });
    const reply = JSON.parse(response.text || "null");
    if (!reply || typeof reply.prompt !== "string" || typeof reply.feedback !== "string" || typeof reply.correct !== "boolean"
      || (body.action === "prepare" ? !reply.prompt.trim() : !reply.feedback.trim())) throw new Error("Invalid AI response");
    return Response.json({ ...reply, correct: body.action === "check" && reply.correct }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "ИИ не ответил. Попробуйте ещё раз — текущая реплика сохранена." }, { status: 502 });
  }
}
