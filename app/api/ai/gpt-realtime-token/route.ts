import { NextResponse } from "next/server";
import { getOpenAiApiKeyForRequest } from "@/lib/ai/serverAuth";
import { GPT_REALTIME_MODEL, GPT_REALTIME_REASONING_EFFORT, GPT_REALTIME_TRANSCRIBE_MODEL, GPT_REALTIME_TRANSLATE_INSTRUCTIONS, GPT_REALTIME_VOICE } from "@/lib/ai/gptRealtimeModels";

export const dynamic = "force-dynamic";

type ClientSecretResponse = {
  value?: string;
  expires_at?: number;
};

/**
 * Issues a short-lived client secret for a WebRTC session against the
 * general-purpose gpt-realtime-2.1, steered into a translator by
 * `instructions` — the fallback path when gpt-realtime-translate's own
 * quality disappoints. Mirrors /api/ai/gpt-translate-token's shape exactly,
 * just against /v1/realtime/client_secrets instead of the translations
 * subresource.
 */
export async function GET(req: Request) {
  try {
    const apiKey = await getOpenAiApiKeyForRequest(req);
    const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model: GPT_REALTIME_MODEL,
          instructions: GPT_REALTIME_TRANSLATE_INSTRUCTIONS,
          // Translating one sentence needs no multi-step reasoning; the
          // default effort tier was enough for the model to narrate a
          // thinking pause before answering — exactly what an interpreter
          // must never do. See the constant's own comment for the reasoning.
          reasoning: { effort: GPT_REALTIME_REASONING_EFFORT },
          audio: {
            input: {
              transcription: { model: GPT_REALTIME_TRANSCRIBE_MODEL },
              noise_reduction: { type: "near_field" },
            },
            output: { voice: GPT_REALTIME_VOICE },
          },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`GPT realtime token unavailable (${response.status}):`, detail);
      return NextResponse.json({ error: "Не удалось подготовить защищённое соединение" }, { status: 503 });
    }

    const data = await response.json() as ClientSecretResponse;
    if (!data.value) {
      return NextResponse.json({ error: "Не удалось подготовить защищённое соединение" }, { status: 503 });
    }

    return NextResponse.json({ token: data.value, model: GPT_REALTIME_MODEL });
  } catch (error) {
    console.warn("GPT realtime token unavailable:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Не удалось подготовить защищённое соединение" }, { status: 503 });
  }
}
