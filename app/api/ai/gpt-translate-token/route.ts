import { NextResponse } from "next/server";
import { getOpenAiApiKeyForRequest } from "@/lib/ai/serverAuth";
import { GPT_TRANSLATE_MODEL, GPT_TRANSLATE_TRANSCRIBE_MODEL } from "@/lib/ai/gptTranslateModels";

export const dynamic = "force-dynamic";

type ClientSecretResponse = {
  value?: string;
  expires_at?: number;
  session?: { id?: string };
};

/**
 * Issues a short-lived client secret for the browser's direct WebRTC session
 * with gpt-realtime-translate.
 *
 * Mirrors /api/ai/live-translate-token's shape (Gemini's ephemeral token
 * route), but the OpenAI side of it: a client_secret minted server-side with
 * the real API key, handed to the browser, which never sees that key. The
 * browser then exchanges this secret for an SDP answer directly against
 * OpenAI's /v1/realtime/translations/calls — this route never proxies audio.
 */
export async function GET(req: Request) {
  try {
    const apiKey = await getOpenAiApiKeyForRequest(req);
    const response = await fetch("https://api.openai.com/v1/realtime/translations/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Long enough to survive a slow WebRTC handshake on a weak connection,
        // short enough that a leaked value is worthless within the hour.
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          model: GPT_TRANSLATE_MODEL,
          audio: {
            input: {
              transcription: { model: GPT_TRANSLATE_TRANSCRIBE_MODEL },
              // near_field: a phone mic held close to the mouth, not a
              // conference-room mic across a table — matches how this screen
              // is actually used.
              noise_reduction: { type: "near_field" },
            },
            output: { language: "ru" },
          },
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      console.warn(`GPT translate token unavailable (${response.status}):`, detail);
      return NextResponse.json({ error: "Не удалось подготовить защищённое соединение" }, { status: 503 });
    }

    const data = await response.json() as ClientSecretResponse;
    if (!data.value) {
      return NextResponse.json({ error: "Не удалось подготовить защищённое соединение" }, { status: 503 });
    }

    return NextResponse.json({ token: data.value, model: GPT_TRANSLATE_MODEL });
  } catch (error) {
    console.warn("GPT translate token unavailable:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Не удалось подготовить защищённое соединение" }, { status: 503 });
  }
}
