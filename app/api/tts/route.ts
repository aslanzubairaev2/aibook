import { NextResponse } from "next/server";
import { sbGetCachedTts, sbSaveCachedTts } from "@/lib/db/supabase";
import {
  DEEPGRAM_TTS_SAMPLE_RATE,
  getDeepgramTtsModel,
  getSpeechifyLocale,
  getSpeechifyModel,
  normalizeLanguageCode,
} from "@/lib/ttsProviders";
import { diagnoseQuotaError, quotaMessageRu } from "@/lib/ttsQuota";
import { parseWav } from "@/lib/wav";
import { getUserFromRequest } from "@/lib/auth/serverUser";

const MAX_TTS_TEXT_LENGTH = 2000;
const GEMINI_TTS_MODEL = "gemini-3.1-flash-tts-preview";

export async function POST(req: Request) {
  try {
    // Server-side TTS burns our Gemini/Deepgram API keys — require a logged-in user.
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text, lang, provider = "gemini" } = await req.json() as {
      text: string;
      lang: string;
      provider?: "gemini" | "deepgram" | "speechify";
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return NextResponse.json({ error: `TTS text exceeds ${MAX_TTS_TEXT_LENGTH} character limit` }, { status: 413 });
    }

    if (provider === "speechify") {
      const locale = getSpeechifyLocale(lang);
      if (!locale) {
        return NextResponse.json({ error: "Speechify TTS does not support this language" }, { status: 400 });
      }
      if (!process.env.SPEECHIFY_API_KEY) {
        return NextResponse.json({ error: "Missing Speechify API key" }, { status: 500 });
      }
      if (!process.env.SPEECHIFY_VOICE_ID) {
        return NextResponse.json(
          { error: "Не выбран голос Speechify — задайте SPEECHIFY_VOICE_ID." },
          { status: 500 },
        );
      }

      const spoken = await speakWithSpeechify(text, lang, locale);
      if ("error" in spoken) {
        return NextResponse.json({ error: spoken.error }, { status: spoken.status });
      }
      return NextResponse.json({ ...spoken, provider, model: getSpeechifyModel(lang) });
    }

    if (provider === "deepgram") {
      const model = getDeepgramTtsModel(lang);

      if (!model) {
        return NextResponse.json({ error: "Deepgram TTS does not support this language" }, { status: 400 });
      }

      if (!process.env.DEEPGRAM_API_KEY) {
        return NextResponse.json({ error: "Missing Deepgram API key" }, { status: 500 });
      }

      const spoken = await speakWithDeepgram(text, lang, model);
      if ("error" in spoken) {
        return NextResponse.json({ error: spoken.error }, { status: spoken.status });
      }
      return NextResponse.json({ ...spoken, provider, model });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 500 });
    }

    // Use Algenib voice as requested
    const voiceName = "Algenib";

    // 1. Check database cache
    const cachedAudio = await sbGetCachedTts(text, lang, voiceName);
    if (cachedAudio) {
      return NextResponse.json({ audioBase64: cachedAudio, source: "db_cache" });
    }

    const makeRequest = async (inputText: string) => {
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TTS_MODEL}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: inputText }]
            }
          ],
          safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: {
                  voiceName
                }
              }
            }
          }
        })
      });
    };

    let response = await makeRequest(text);

    if (!response.ok) {
      const err = await response.text();

      // A rate limit is the one failure the learner can act on, so it gets
      // named rather than flattened into "TTS failed" — and, when the language
      // has a Deepgram voice, answered with that voice instead of silence.
      if (response.status === 429) {
        const quota = diagnoseQuotaError(err);
        console.error(
          `Gemini TTS quota hit [${quota.quotaId ?? "unknown quota"}] window=${quota.window} freeTier=${quota.freeTier} limit=${quota.limit ?? "?"}:`,
          err,
        );

        const deepgramModel = getDeepgramTtsModel(lang);
        if (deepgramModel && process.env.DEEPGRAM_API_KEY) {
          const spoken = await speakWithDeepgram(text, lang, deepgramModel);
          if (!("error" in spoken)) {
            return NextResponse.json({
              ...spoken,
              provider: "deepgram",
              model: deepgramModel,
              fellBackFrom: "gemini",
              reason: quotaMessageRu(quota),
            });
          }
        }

        return NextResponse.json(
          {
            error: quotaMessageRu(quota),
            quota: {
              window: quota.window,
              freeTier: quota.freeTier,
              limit: quota.limit,
              quotaId: quota.quotaId,
              model: GEMINI_TTS_MODEL,
            },
            retryAfterSeconds: quota.retryAfterSeconds,
          },
          {
            status: 429,
            headers: quota.retryAfterSeconds ? { "Retry-After": String(quota.retryAfterSeconds) } : undefined,
          },
        );
      }

      console.error("Gemini TTS API error:", err);
      return NextResponse.json({ error: "TTS failed" }, { status: response.status });
    }

    let data = await response.json();
    let inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;

    // Fallback: If blocked due to safety/PROHIBITED_CONTENT (especially for short words like "Sie", "-", "kill")
    if (!inlineData && data.promptFeedback?.blockReason === "PROHIBITED_CONTENT") {
      console.log(`TTS blocked for "${text}", retrying with quotes...`);
      response = await makeRequest(`"${text}"`);
      if (response.ok) {
        data = await response.json();
        inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
      }
    }

    if (inlineData?.data) {
      // 2. Save to database cache
      await sbSaveCachedTts(text, lang, voiceName, inlineData.data);
      return NextResponse.json({ audioBase64: inlineData.data, source: "api" });
    }

    return NextResponse.json({ error: "No audio data received" }, { status: 500 });
  } catch (error) {
    console.error("TTS Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

type Spoken =
  | { audioBase64: string; source: "api" | "db_cache"; sampleRate?: number }
  | { error: string; status: number };

/**
 * Synthesise through Speechify Simba.
 *
 * Speechify chooses its own sample rate per model, and the player has to be
 * told which one — so the WAV goes into the cache with its header intact and
 * gets parsed on the way out. A cache hit and a fresh call then answer with the
 * same rate, instead of a cached card playing at the wrong pitch.
 */
async function speakWithSpeechify(text: string, lang: string, locale: string): Promise<Spoken> {
  const apiKey = process.env.SPEECHIFY_API_KEY;
  const voiceId = process.env.SPEECHIFY_VOICE_ID;
  if (!apiKey || !voiceId) return { error: "Missing Speechify configuration", status: 500 };

  const model = getSpeechifyModel(lang);
  // The voice is part of the identity of the recording: switching voices must
  // not serve the old one out of the cache.
  const cacheVoiceKey = `${model}:${voiceId}`;
  const language = normalizeLanguageCode(lang);

  const cachedWav = await sbGetCachedTts(text, language, cacheVoiceKey);
  if (cachedWav) {
    const decoded = decodeWavBase64(cachedWav);
    if (decoded) return { ...decoded, source: "db_cache" };
    // A cache row we can no longer read is worth replacing, not dying on.
    console.warn("Speechify cache row was not readable WAV; re-synthesising");
  }

  const response = await fetch("https://api.sws.speechify.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      voice_id: voiceId,
      model,
      language: locale,
      audio_format: "wav",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`Speechify TTS API error (${response.status}, model=${model}, locale=${locale}):`, err);
    // Simba 3.2 is English-only and rejects other languages outright; say so
    // rather than leaving a bare 400 in the console.
    if (response.status === 400 && /language|locale|not support/i.test(err)) {
      return { error: `Голос Speechify не поддерживает язык ${locale}. Выберите другой голос или модель.`, status: 400 };
    }
    return { error: "Speechify TTS failed", status: response.status };
  }

  const data = await response.json() as { audio_data?: string };
  if (!data.audio_data) return { error: "Speechify returned no audio", status: 502 };

  const decoded = decodeWavBase64(data.audio_data);
  if (!decoded) return { error: "Speechify returned audio the player cannot decode", status: 502 };

  await sbSaveCachedTts(text, language, cacheVoiceKey, data.audio_data);
  return { ...decoded, source: "api" };
}

/** WAV base64 → headerless PCM base64 plus the rate it must be played at. */
function decodeWavBase64(wavBase64: string): { audioBase64: string; sampleRate: number } | null {
  try {
    const bytes = Buffer.from(wavBase64, "base64");
    // Buffer may be a view into a larger pool; copy out the exact range.
    const wav = parseWav(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    return {
      audioBase64: Buffer.from(wav.pcm).toString("base64"),
      sampleRate: wav.sampleRate,
    };
  } catch (err) {
    console.error("Speechify WAV parse failed:", err);
    return null;
  }
}

/**
 * Synthesise through Deepgram, cache included.
 *
 * Shared by the Deepgram provider and by the Gemini quota fallback, so a
 * rate-limited card is still read out in a real voice rather than dropping to
 * the browser's robot.
 */
async function speakWithDeepgram(text: string, lang: string, model: string): Promise<Spoken> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return { error: "Missing Deepgram API key", status: 500 };

  const language = normalizeLanguageCode(lang);
  const cachedAudio = await sbGetCachedTts(text, language, model);
  if (cachedAudio) return { audioBase64: cachedAudio, source: "db_cache" };

  const url = new URL("https://api.deepgram.com/v1/speak");
  url.searchParams.set("model", model);
  url.searchParams.set("encoding", "linear16");
  url.searchParams.set("sample_rate", String(DEEPGRAM_TTS_SAMPLE_RATE));
  url.searchParams.set("container", "none");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error("Deepgram TTS API error:", err);
    return { error: "Deepgram TTS failed", status: response.status };
  }

  const audioBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
  await sbSaveCachedTts(text, language, model, audioBase64);
  return { audioBase64, source: "api" };
}
