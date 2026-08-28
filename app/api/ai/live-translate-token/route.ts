import { NextResponse } from "next/server";
import { GoogleGenAI, Modality } from "@google/genai";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { LIVE_TRANSLATE_MODEL } from "@/lib/ai/liveModels";

export const dynamic = "force-dynamic";

/** Issues a single-use, short-lived token for the browser's direct Live API socket. */
export async function GET(req: Request) {
  try {
    const apiKey = await getApiKeyForRequest(req);
    const client = new GoogleGenAI({ apiKey });
    const token = await client.authTokens.create({
      config: {
        uses: 1,
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
        liveConnectConstraints: {
          model: LIVE_TRANSLATE_MODEL,
          config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            translationConfig: { targetLanguageCode: "ru", echoTargetLanguage: true },
          },
        },
      },
    });
    return NextResponse.json({ token: token.name, model: LIVE_TRANSLATE_MODEL });
  } catch (error) {
    console.warn("Live translate token unavailable:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Не удалось подготовить защищённое соединение" }, { status: 503 });
  }
}
