// GET /api/tts/voices?provider=… — the voices this engine can speak with.
//
// Two of the engines ship a fixed cast with the model, and those lists live in
// the code where the settings screen can read them without a round trip. The
// other two keep their voices in the account, which only the server may ask
// about — its key, not the browser's. So the screen asks here either way and
// gets one shape back.
//
// Only male voices are offered: that is the whole request, and both accounts
// label their voices well enough to filter on.

import { NextResponse } from "next/server";
import {
  CARTESIA_API_VERSION,
  getStaticTtsVoices,
  normalizeTtsProvider,
  supportsVoiceChoice,
  type TtsVoiceOption,
} from "@/lib/ttsProviders";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const provider = normalizeTtsProvider(new URL(req.url).searchParams.get("provider"));
  if (!supportsVoiceChoice(provider)) {
    return NextResponse.json({ provider, voices: [] });
  }

  const fixed = getStaticTtsVoices(provider);
  if (fixed) return NextResponse.json({ provider, voices: fixed });

  try {
    const voices = provider === "elevenlabs" ? await listElevenLabsVoices() : await listCartesiaVoices();
    if ("error" in voices) {
      return NextResponse.json({ error: voices.error }, { status: voices.status });
    }
    return NextResponse.json({ provider, voices: voices.voices });
  } catch (error) {
    console.error(`${provider} voice list threw:`, error);
    return NextResponse.json({ error: "Не удалось получить список голосов." }, { status: 502 });
  }
}

type VoiceList = { voices: TtsVoiceOption[] } | { error: string; status: number };

/** Male voices from the ElevenLabs account, newest library entries included. */
async function listElevenLabsVoices(): Promise<VoiceList> {
  const apiKey = (process.env.ELEVENLABS_API_KEY || process.env.ELVENLABS_API_KEY || "").trim();
  if (!apiKey) return { error: "Не задан ключ ElevenLabs (ELEVENLABS_API_KEY).", status: 500 };

  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    console.error(`ElevenLabs voice list failed (${response.status}):`, await response.text());
    return { error: `ElevenLabs вернул ошибку ${response.status}.`, status: 502 };
  }

  const payload = await response.json() as {
    voices?: { voice_id?: string; name?: string; labels?: Record<string, string> }[];
  };

  const voices = (payload.voices ?? [])
    .filter((voice) => voice.voice_id && voice.name)
    // The label is the account's own, so trust it; a voice with no gender label
    // is kept rather than hidden, since silence there is not "female".
    .filter((voice) => (voice.labels?.gender ?? "male").toLowerCase() !== "female")
    .map((voice) => ({
      id: voice.voice_id as string,
      name: voice.name as string,
      hint: [voice.labels?.accent, voice.labels?.description].filter(Boolean).join(", ") || undefined,
    }));

  return { voices };
}

/** Male voices from the Cartesia library. */
async function listCartesiaVoices(): Promise<VoiceList> {
  const apiKey = (process.env.CARTESIA_API_KEY || "").trim();
  if (!apiKey) return { error: "Не задан ключ Cartesia (CARTESIA_API_KEY).", status: 500 };

  const url = new URL("https://api.cartesia.ai/voices");
  url.searchParams.set("limit", "100");

  const response = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Cartesia-Version": CARTESIA_API_VERSION,
    },
  });
  if (!response.ok) {
    console.error(`Cartesia voice list failed (${response.status}):`, await response.text());
    return { error: `Cartesia вернула ошибку ${response.status}.`, status: 502 };
  }

  const payload = await response.json() as
    | { id?: string; name?: string; gender?: string; description?: string; language?: string }[]
    | { data?: { id?: string; name?: string; gender?: string; description?: string; language?: string }[] };

  const list = Array.isArray(payload) ? payload : payload.data ?? [];
  const voices = list
    .filter((voice) => voice.id && voice.name)
    .filter((voice) => (voice.gender ?? "masculine").toLowerCase() !== "feminine")
    .map((voice) => ({
      id: voice.id as string,
      name: voice.name as string,
      hint: voice.description?.slice(0, 60) || voice.language || undefined,
    }));

  return { voices };
}
