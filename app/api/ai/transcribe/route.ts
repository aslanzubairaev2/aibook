import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { DICTATION_MAX_BYTES, DICTATION_MODEL, dictationSeconds, dictationVocabulary } from "@/lib/audio/dictation";

export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };
const reply = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

export async function POST(req: Request) {
  let apiKey: string;
  try { apiKey = await getApiKeyForRequest(req); }
  catch { return reply("Для диктовки войдите в аккаунт с доступом к Gemini или укажите свой ключ в настройках.", 403); }
  if (!req.headers.get("content-type")?.startsWith("multipart/form-data")) return reply("Ожидалась запись микрофона.", 400);
  const length = Number(req.headers.get("content-length"));
  if (length > DICTATION_MAX_BYTES + 16384) return reply("Запись слишком большая. Максимум — 60 секунд.", 413);
  let audio: File;
  let context: string;
  let seconds: number;
  let buffer: ArrayBuffer;
  try {
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File) || file.type !== "audio/wav" || file.size > DICTATION_MAX_BYTES) return reply("Некорректная запись WAV или превышен лимит размера.", 400);
    audio = file;
    context = String(form.get("context") || "").slice(0, 1200);
    buffer = await audio.arrayBuffer();
    seconds = dictationSeconds(buffer);
    if (seconds < 0.3) return reply("Запись слишком короткая. Запишите хотя бы полсекунды речи.", 400);
  } catch { return reply("Не удалось прочитать запись микрофона.", 400); }
  try {
    // Inline audio avoids Files API uploads. No conversation history, logs or DB persistence.
    // Raw fetch has no SDK retries: one user action sends at most one provider request.
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(45000)]),
      cache: "no-store",
      body: JSON.stringify({
        model: DICTATION_MODEL, store: false,
        input: [{ type: "audio", data: Buffer.from(buffer).toString("base64"), mime_type: "audio/wav" }],
        generation_config: {
          transcription_config: {
            language_codes: [], // Automatic language detection, including switching within one sentence.
            custom_vocabulary: dictationVocabulary(context),
            mode: { type: "verbatim" },
          },
        },
      }),
    });
    if (!response.ok) {
      if (response.status === 429) return reply("Gemini ограничил запросы или исчерпана квота. Запись повторно не отправлялась.", 429);
      if (response.status === 403 || response.status === 404) return reply("Gemini Transcribe недоступен для этого ключа. Проверьте доступ к модели.", 422);
      return reply("Gemini не смог распознать запись. Автоповтор отключён.", 502);
    }
    const data = await response.json() as {
      status?: string; output_text?: string;
      steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
    };
    if (data.status && data.status !== "completed") return reply("Gemini не завершил распознавание. Запись повторно не отправлялась.", 502);
    const text = (data.output_text || data.steps?.filter(step => step.type === "model_output")
      .flatMap(step => step.content || []).filter(part => part.type === "text").map(part => part.text || "").join("") || "").trim();
    if (!text) return reply("Речь не распознана. Попробуйте говорить ближе к микрофону.", 422);
    return NextResponse.json({ text, seconds, model: DICTATION_MODEL }, { headers });
  } catch {
    return reply("Распознавание прервалось или заняло слишком долго. Автоповтор отключён; отправленная запись могла учитываться в квоте.", 504);
  }
}
