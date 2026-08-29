import { NextResponse } from "next/server";
import { getOpenAiApiKeyForRequest } from "@/lib/ai/serverAuth";
import { GPT_REALTIME_MODEL, GPT_REALTIME_TRANSCRIBE_MODEL, GPT_REALTIME_VOICE } from "@/lib/ai/gptRealtimeModels";

export const dynamic = "force-dynamic";

type ClientSecretResponse = {
  value?: string;
  expires_at?: number;
};

/**
 * Issues a short-lived client secret for a WebRTC session against the
 * general-purpose gpt-realtime-2.1.
 *
 * TEMPORARY DIAGNOSTIC STATE: `instructions` and `reasoning.effort` (the
 * translate-only system prompt and the "minimal" reasoning override — see
 * GPT_REALTIME_TRANSLATE_INSTRUCTIONS / GPT_REALTIME_REASONING_EFFORT in
 * gptRealtimeModels.ts, both still defined but unused here) are deliberately
 * NOT sent. Even with them, the model waited for the speaker to finish and
 * only then translated — same turn-based behavior a stock session has. The
 * point of running it stock is to test, by voice, whether this model/session
 * shape can do the closer-to-simultaneous translation the ChatGPT app
 * achieves when told to "translate as I talk" directly, the way the user
 * would drive the ChatGPT app itself. If it can, the fix is in how the turn
 * is configured; if it can't either, the gap is inherent to this app's setup
 * and no amount of prompt/reasoning tuning was going to close it.
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
