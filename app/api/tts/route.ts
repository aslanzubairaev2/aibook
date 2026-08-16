import { NextResponse } from "next/server";
import { sbGetCachedTts, sbSaveCachedTts } from "@/lib/db/supabase";
import {
  CARTESIA_API_VERSION,
  CARTESIA_DEFAULT_VOICE,
  CARTESIA_MODEL,
  CARTESIA_SAMPLE_RATE,
  DEEPGRAM_TTS_SAMPLE_RATE,
  ELEVENLABS_DEFAULT_VOICE,
  ELEVENLABS_MODEL,
  ELEVENLABS_MP3_FORMAT,
  ELEVENLABS_PCM_FORMAT,
  ELEVENLABS_PCM_SAMPLE_RATE,
  GEMINI_MALE_VOICES,
  GEMINI_TTS_FALLBACK_MODELS,
  GEMINI_TTS_MODEL,
  getBcp47Locale,
  getElevenLabsVoiceIdByName,
  isCartesiaTtsSupported,
  isCartesiaVoiceId,
  isElevenLabsTtsSupported,
  buildGeminiSpeechPrompt,
  getElevenLabsLanguageCode,
  SPEECH_STYLE_VERSION,
  isValidModelRef,
  isValidVoiceRef,
  OPENAI_SPEAKING_RATE,
  teacherInstructions,
  getInworldAuthorizationHeader,
  getDeepgramTtsModel,
  getSpeechifyLocale,
  getSpeechifyModel,
  getTtsProviderChain,
  INWORLD_DEFAULT_VOICE,
  INWORLD_MODEL,
  normalizeLanguageCode,
  normalizeOpenAiVoice,
  OPENAI_DEFAULT_VOICE,
  OPENAI_TTS_MODEL,
  OPENAI_VOICES,
} from "@/lib/ttsProviders";
import type { TtsProvider } from "@/lib/types";
import { diagnoseQuotaError, quotaMessageRu } from "@/lib/ttsQuota";
import { parseWav } from "@/lib/wav";
import { getUserFromRequest } from "@/lib/auth/serverUser";

const MAX_TTS_TEXT_LENGTH = 2000;

export async function POST(req: Request) {
  try {
    // Server-side TTS burns our Gemini/Deepgram API keys — require a logged-in user.
    const user = await getUserFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { text, lang, provider = "gemini", voice, model, refresh } = await req.json() as {
      text: string;
      lang: string;
      provider?: TtsProvider;
      /**
       * A re-record: the learner heard something wrong and asked for it again.
       *
       * The cached row is the wrong recording, so reading it would answer the
       * request with exactly what was being complained about. It is skipped and
       * then overwritten, which is also what makes the fix stick for everyone
       * who reaches that row later.
       */
      refresh?: boolean;
      /** The voice the learner picked in settings, if this engine has a choice. */
      voice?: string;
      /** Likewise the model, for trying one engine's models against each other. */
      model?: string;
    };

    // Both are about to be spent against our key, so they are held to the shape
    // provider ids share rather than forwarded as free text.
    // A flag from the client is not a promise of a boolean; treat it as one.
    const fresh = refresh === true;

    const chosenVoice = typeof voice === "string" && isValidVoiceRef(voice) ? voice.trim() : undefined;
    const chosenModel = typeof model === "string" && isValidModelRef(model) ? model.trim() : undefined;

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return NextResponse.json({ error: `TTS text exceeds ${MAX_TTS_TEXT_LENGTH} character limit` }, { status: 413 });
    }

    if (provider === "openai") {
      if (!getOpenAiApiKey()) {
        return NextResponse.json({ error: "Не задан ключ OpenAI (GPT_API_KEY)." }, { status: 500 });
      }

      const spoken = await speakWithOpenAi(text, lang, fresh, chosenVoice, chosenModel);
      if ("error" in spoken) {
        return NextResponse.json({ error: spoken.error }, { status: spoken.status });
      }
      return NextResponse.json({ ...spoken, provider, model: chosenModel || OPENAI_TTS_MODEL });
    }

    if (provider === "elevenlabs") {
      if (!isElevenLabsTtsSupported(lang)) {
        return NextResponse.json({ error: "ElevenLabs does not support this language" }, { status: 400 });
      }
      if (!getElevenLabsApiKey()) {
        return NextResponse.json({ error: "Не задан ключ ElevenLabs (ELEVENLABS_API_KEY)." }, { status: 500 });
      }

      const spoken = await speakWithElevenLabs(text, lang, fresh, chosenVoice, chosenModel);
      if ("error" in spoken) {
        return NextResponse.json({ error: spoken.error }, { status: spoken.status });
      }
      return NextResponse.json({ ...spoken, provider, model: getElevenLabsModel(chosenModel) });
    }

    if (provider === "cartesia") {
      if (!isCartesiaTtsSupported(lang)) {
        return NextResponse.json({ error: "Cartesia TTS does not support this language" }, { status: 400 });
      }
      if (!process.env.CARTESIA_API_KEY) {
        return NextResponse.json({ error: "Не задан ключ Cartesia (CARTESIA_API_KEY)." }, { status: 500 });
      }

      const spoken = await speakWithCartesia(text, lang, fresh, chosenVoice, chosenModel);
      if ("error" in spoken) {
        return NextResponse.json({ error: spoken.error }, { status: spoken.status });
      }
      return NextResponse.json({ ...spoken, provider, model: getCartesiaModel(chosenModel) });
    }

    if (provider === "inworld") {
      const locale = getBcp47Locale(lang);
      if (!locale) {
        return NextResponse.json({ error: "Inworld TTS does not support this language" }, { status: 400 });
      }
      if (!process.env.INWORLD_API_KEY) {
        return NextResponse.json({ error: "Не задан ключ Inworld (INWORLD_API_KEY)." }, { status: 500 });
      }

      const spoken = await speakWithInworld(text, lang, fresh, locale);
      if ("error" in spoken) {
        return NextResponse.json({ error: spoken.error }, { status: spoken.status });
      }
      return NextResponse.json({ ...spoken, provider, model: INWORLD_MODEL });
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

      const spoken = await speakWithSpeechify(text, lang, fresh, locale);
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

      const spoken = await speakWithDeepgram(text, lang, fresh, model);
      if ("error" in spoken) {
        return NextResponse.json({ error: spoken.error }, { status: spoken.status });
      }
      return NextResponse.json({ ...spoken, provider, model });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      const reason = "Gemini TTS не настроен: отсутствует GEMINI_API_KEY.";
      const fallback = await speakWithAutomaticFallback(text, lang, fresh, reason);
      if (fallback) return NextResponse.json(fallback);
      return NextResponse.json({ error: reason }, { status: 500 });
    }

    // The learner's pick from settings, or the voice this app has always used.
    const voiceName = chosenVoice && GEMINI_MALE_VOICES.some((v) => v.id === chosenVoice)
      ? chosenVoice
      : "Algenib";

    const geminiModel = chosenModel || GEMINI_TTS_MODEL;
    // Only a model other than the usual one joins the key: everything recorded
    // before models could be chosen was recorded with that one, and re-earning
    // a full cache costs quota a preview model counts by the request.
    //
    // The style version does join it, though, and knowingly costs that quota.
    // Every recording made before the model was told anything is in whichever
    // language it guessed, acted out or not — which is the thing being fixed,
    // so serving those again would be serving the bug.
    const geminiCacheKey = geminiModel === GEMINI_TTS_MODEL
      ? `${voiceName}:${SPEECH_STYLE_VERSION}`
      : `${geminiModel}:${voiceName}:${SPEECH_STYLE_VERSION}`;

    // 1. Check database cache
    const cachedAudio = fresh ? null : await sbGetCachedTts(text, lang, geminiCacheKey);
    if (cachedAudio) {
      return NextResponse.json({ audioBase64: cachedAudio, source: "db_cache", provider: "gemini", model: geminiModel });
    }

    const makeRequest = (inputText: string) => geminiTtsRequest(apiKey, geminiModel, voiceName, inputText, lang);

    let response: Response;
    try {
      response = await makeRequest(text);
    } catch (error) {
      console.error("Gemini TTS request failed:", error);
      const reason = "Не удалось связаться с Gemini TTS.";
      const fallback = await speakWithAutomaticFallback(text, lang, fresh, reason, {
        voiceName,
        spentModel: geminiModel,
      });
      if (fallback) return NextResponse.json(fallback);
      throw error;
    }

    if (!response.ok) {
      const err = await response.text();

      // A rate limit is the one failure the learner can act on, so it gets
      // named rather than flattened into "TTS failed", then tried through the
      // configured Speechify and Inworld fallbacks.
      if (response.status === 429) {
        const quota = diagnoseQuotaError(err);
        console.error(
          `Gemini TTS quota hit [${quota.quotaId ?? "unknown quota"}] window=${quota.window} freeTier=${quota.freeTier} limit=${quota.limit ?? "?"}:`,
          err,
        );

        const fallback = await speakWithAutomaticFallback(text, lang, fresh, quotaMessageRu(quota), {
          voiceName,
          spentModel: geminiModel,
        });
        if (fallback) return NextResponse.json(fallback);

        return NextResponse.json(
          {
            error: quotaMessageRu(quota),
            quota: {
              window: quota.window,
              freeTier: quota.freeTier,
              limit: quota.limit,
              quotaId: quota.quotaId,
              model: geminiModel,
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
      const reason = `Gemini TTS недоступен (ошибка ${response.status}).`;
      const fallback = await speakWithAutomaticFallback(text, lang, fresh, reason, {
        voiceName,
        spentModel: geminiModel,
      });
      if (fallback) return NextResponse.json(fallback);
      return NextResponse.json({ error: reason }, { status: response.status });
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
      await sbSaveCachedTts(text, lang, geminiCacheKey, inlineData.data);
      return NextResponse.json({ audioBase64: inlineData.data, source: "api", provider: "gemini", model: geminiModel });
    }

    const reason = "Gemini TTS не вернул аудио.";
    const fallback = await speakWithAutomaticFallback(text, lang, fresh, reason, {
      voiceName,
      spentModel: geminiModel,
    });
    if (fallback) return NextResponse.json(fallback);
    return NextResponse.json({ error: reason }, { status: 500 });
  } catch (error) {
    console.error("TTS Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

type Spoken =
  | { audioBase64: string; source: "api" | "db_cache"; sampleRate?: number; format?: "mp3" }
  | { error: string; status: number };

type AutomaticFallback = Exclude<Spoken, { error: string; status: number }> & {
  provider: "gemini" | "speechify" | "inworld" | "openai" | "cartesia" | "elevenlabs";
  model: string;
  fellBackFrom: "gemini";
  reason: string;
};

async function speakWithAutomaticFallback(
  text: string,
  lang: string,
  fresh: boolean,
  reason: string,
  gemini?: { voiceName: string; spentModel: string },
): Promise<AutomaticFallback | null> {
  // Gemini's free allowance is counted per model, so the sibling model is a
  // fresh allowance rather than the same spent one — and it is free, which the
  // engines below it are not. Try it before reaching for a paid voice.
  const apiKey = process.env.GEMINI_API_KEY;
  if (gemini && apiKey) {
    const alternates = [GEMINI_TTS_MODEL, ...GEMINI_TTS_FALLBACK_MODELS]
      .filter((model) => model !== gemini.spentModel);

    for (const model of alternates) {
      try {
        const spoken = await speakWithGeminiModel(text, lang, fresh, model, gemini.voiceName, apiKey);
        if (!("error" in spoken)) {
          return { ...spoken, provider: "gemini", model, fellBackFrom: "gemini", reason };
        }
        console.warn(`Gemini ${model} fallback failed with status ${spoken.status}: ${spoken.error}`);
      } catch (error) {
        console.error(`Gemini ${model} fallback threw:`, error);
      }
    }
  }

  for (const provider of getTtsProviderChain("gemini", lang).slice(1)) {
    try {
      if (provider === "speechify") {
        const locale = getSpeechifyLocale(lang);
        if (!locale || !process.env.SPEECHIFY_API_KEY || !process.env.SPEECHIFY_VOICE_ID) continue;

        const spoken = await speakWithSpeechify(text, lang, fresh, locale);
        if (!("error" in spoken)) {
          return {
            ...spoken,
            provider: "speechify",
            model: getSpeechifyModel(lang),
            fellBackFrom: "gemini",
            reason,
          };
        }
        console.warn(`Speechify fallback failed with status ${spoken.status}: ${spoken.error}`);
        continue;
      }

      if (provider === "inworld") {
        const locale = getBcp47Locale(lang);
        if (!locale || !process.env.INWORLD_API_KEY) continue;

        const spoken = await speakWithInworld(text, lang, fresh, locale);
        if (!("error" in spoken)) {
          return {
            ...spoken,
            provider: "inworld",
            model: INWORLD_MODEL,
            fellBackFrom: "gemini",
            reason,
          };
        }
        console.warn(`Inworld fallback failed with status ${spoken.status}: ${spoken.error}`);
        continue;
      }

      if (provider === "openai") {
        if (!getOpenAiApiKey()) continue;

        const spoken = await speakWithOpenAi(text, lang, fresh);
        if (!("error" in spoken)) {
          return {
            ...spoken,
            provider: "openai",
            model: OPENAI_TTS_MODEL,
            fellBackFrom: "gemini",
            reason,
          };
        }
        console.warn(`OpenAI fallback failed with status ${spoken.status}: ${spoken.error}`);
        continue;
      }

      if (provider === "cartesia") {
        if (!process.env.CARTESIA_API_KEY) continue;

        const spoken = await speakWithCartesia(text, lang, fresh);
        if (!("error" in spoken)) {
          return {
            ...spoken,
            provider: "cartesia",
            model: CARTESIA_MODEL,
            fellBackFrom: "gemini",
            reason,
          };
        }
        console.warn(`Cartesia fallback failed with status ${spoken.status}: ${spoken.error}`);
        continue;
      }

      if (provider === "elevenlabs") {
        if (!getElevenLabsApiKey()) continue;

        const spoken = await speakWithElevenLabs(text, lang, fresh);
        if (!("error" in spoken)) {
          return {
            ...spoken,
            provider: "elevenlabs",
            model: getElevenLabsModel(),
            fellBackFrom: "gemini",
            reason,
          };
        }
        console.warn(`ElevenLabs fallback failed with status ${spoken.status}: ${spoken.error}`);
      }
    } catch (error) {
      console.error(`${provider} fallback threw:`, error);
    }
  }

  return null;
}

/**
 * One Gemini speech request.
 *
 * Shared by the main path and by the model fallback: a second hand-kept copy of
 * this body is exactly the kind of thing that drifts out of step.
 */
function geminiTtsRequest(
  apiKey: string,
  model: string,
  voiceName: string,
  inputText: string,
  lang: string,
) {
  return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildGeminiSpeechPrompt(inputText, lang) }] }],
      safetySettings: [
        { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
        { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" },
      ],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
      },
    }),
  });
}

/**
 * Speak through one named Gemini model, cache included.
 *
 * Used when the chosen model has run out of quota: no diagnostics here, since
 * a refusal from this one only means "try the next", and the learner was
 * already told why the first one stopped.
 */
async function speakWithGeminiModel(
  text: string,
  lang: string,
  fresh: boolean,
  model: string,
  voiceName: string,
  apiKey: string,
): Promise<Spoken> {
  // Matches the main path's key exactly, so the two share their recordings.
  const cacheKey = model === GEMINI_TTS_MODEL
    ? `${voiceName}:${SPEECH_STYLE_VERSION}`
    : `${model}:${voiceName}:${SPEECH_STYLE_VERSION}`;

  const cached = fresh ? null : await sbGetCachedTts(text, lang, cacheKey);
  if (cached) return { audioBase64: cached, source: "db_cache" };

  const response = await geminiTtsRequest(apiKey, model, voiceName, text, lang);
  if (!response.ok) {
    return { error: `Gemini ${model}: ${response.status}`, status: response.status };
  }

  const data = await response.json();
  const audioBase64 = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audioBase64) return { error: `Gemini ${model} returned no audio`, status: 502 };

  await sbSaveCachedTts(text, lang, cacheKey, audioBase64);
  return { audioBase64, source: "api" };
}

/**
 * Voice name → id, remembered for the life of the process.
 *
 * Cartesia addresses voices by UUID while its library shows them by name, so a
 * configured name costs one lookup. The account's voices do not move between
 * requests, so that lookup is worth doing once rather than per card.
 */
const cartesiaVoiceIds = new Map<string, string>();

type CartesiaVoice = { id?: string; name?: string };

/**
 * The Cartesia model to speak with.
 *
 * Model ids drift — sonic-2 was current when this was first wired and is not
 * any more — so the deployment can move to a new one without a code change.
 */
function getCartesiaModel(requested?: string) {
  return requested || (process.env.CARTESIA_MODEL_ID || "").trim() || CARTESIA_MODEL;
}

/** Resolve the configured Cartesia voice to the id the synthesis call needs. */
async function resolveCartesiaVoice(
  apiKey: string,
  requested?: string,
): Promise<{ id: string } | { error: string; status: number }> {
  const configured = requested
    || (process.env.CARTESIA_VOICE_ID || process.env.CARTESIA_VOICE || "").trim()
    || CARTESIA_DEFAULT_VOICE;

  // Already an id: nothing to look up.
  if (isCartesiaVoiceId(configured)) return { id: configured };

  const wanted = configured.toLowerCase();
  const remembered = cartesiaVoiceIds.get(wanted);
  if (remembered) return { id: remembered };

  // The library is paged, and a name can sit past the first page.
  let cursor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL("https://api.cartesia.ai/voices");
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("starting_after", cursor);

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Cartesia-Version": CARTESIA_API_VERSION,
      },
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`Cartesia voice list failed (${response.status}):`, err);
      if (response.status === 401 || response.status === 403) {
        return { error: "Cartesia не принял ключ. Проверьте CARTESIA_API_KEY.", status: response.status };
      }
      return {
        error: `Не удалось получить список голосов Cartesia (${response.status}). Укажите UUID в CARTESIA_VOICE_ID.`,
        status: 502,
      };
    }

    const payload = await response.json() as CartesiaVoice[] | { data?: CartesiaVoice[]; has_more?: boolean };
    const voices = Array.isArray(payload) ? payload : payload.data ?? [];
    const match = voices.find((voice) => voice.name?.trim().toLowerCase() === wanted);
    if (match?.id) {
      cartesiaVoiceIds.set(wanted, match.id);
      return { id: match.id };
    }

    const hasMore = !Array.isArray(payload) && payload.has_more;
    const last = voices[voices.length - 1]?.id;
    if (!hasMore || !last) break;
    cursor = last;
  }

  return {
    error: `Cartesia не знает голос «${configured}». Скопируйте его UUID из библиотеки в CARTESIA_VOICE_ID.`,
    status: 400,
  };
}

/**
 * Synthesise through Cartesia Sonic.
 *
 * WAV rather than MP3: the header states the rate, the route strips it to raw
 * PCM, and the player schedules those samples with no decoding step at all.
 * That is the shortest path from bytes to sound the player has.
 */
async function speakWithCartesia(
  text: string,
  lang: string,
  fresh: boolean,
  requestedVoice?: string,
  requestedModel?: string,
): Promise<Spoken> {
  const apiKey = (process.env.CARTESIA_API_KEY || "").trim();
  if (!apiKey) return { error: "Missing Cartesia API key", status: 500 };

  const voice = await resolveCartesiaVoice(apiKey, requestedVoice);
  if ("error" in voice) return voice;

  const model = getCartesiaModel(requestedModel);
  const language = normalizeLanguageCode(lang);
  // The voice is part of the recording's identity, so it belongs in the key.
  const cacheVoiceKey = `${model}:${voice.id}`;

  const cachedWav = fresh ? null : await sbGetCachedTts(text, language, cacheVoiceKey);
  if (cachedWav) {
    const decoded = decodeWavBase64(cachedWav);
    if (decoded) return { ...decoded, source: "db_cache" };
    console.warn("Cartesia cache row was not readable WAV; re-synthesising");
  }

  const response = await fetch("https://api.cartesia.ai/tts/bytes", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Cartesia-Version": CARTESIA_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model_id: model,
      transcript: text,
      voice: { id: voice.id },
      language,
      output_format: {
        container: "wav",
        encoding: "pcm_s16le",
        sample_rate: CARTESIA_SAMPLE_RATE,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`Cartesia TTS API error (${response.status}, model=${model}, voice=${voice.id}, lang=${language}):`, err);
    if (response.status === 401 || response.status === 403) {
      return { error: "Cartesia не приняла ключ. Проверьте CARTESIA_API_KEY.", status: response.status };
    }
    if (response.status === 402 || response.status === 429) {
      return { error: "Cartesia ограничила запросы. Проверьте баланс кредитов.", status: response.status };
    }
    if (/model/i.test(err)) {
      return {
        error: `Cartesia не знает модель «${model}». Задайте актуальную в CARTESIA_MODEL_ID.`,
        status: response.status,
      };
    }
    if (/voice/i.test(err)) {
      // A stale id in the cache is worth forgetting, so the next call re-resolves.
      cartesiaVoiceIds.clear();
      return { error: "Cartesia отклонила голос. Проверьте CARTESIA_VOICE_ID.", status: response.status };
    }
    return { error: "Cartesia TTS failed", status: response.status };
  }

  const wavBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
  const decoded = decodeWavBase64(wavBase64);
  if (!decoded) return { error: "Cartesia returned audio the player cannot decode", status: 502 };

  await sbSaveCachedTts(text, language, cacheVoiceKey, wavBase64);
  return { ...decoded, source: "api" };
}

// ─── ElevenLabs ──────────────────────────────────────────────────────────────

function getElevenLabsApiKey() {
  return (process.env.ELEVENLABS_API_KEY || process.env.ELVENLABS_API_KEY || "").trim();
}

/** The dashboard variable is spelled ELVENLABS_MODEL_ID; take either spelling. */
function getElevenLabsModel(requested?: string) {
  return requested
    || (process.env.ELEVENLABS_MODEL_ID || process.env.ELVENLABS_MODEL_ID || "").trim()
    || ELEVENLABS_MODEL;
}

const elevenLabsVoiceIds = new Map<string, string>();

type ElevenLabsVoice = { voice_id?: string; name?: string; labels?: Record<string, string> };

/** Resolve a voice name — the library shows names, the API wants ids. */
async function resolveElevenLabsVoice(
  apiKey: string,
  requested?: string,
): Promise<{ id: string } | { error: string; status: number }> {
  const configured = requested
    || (process.env.ELEVENLABS_VOICE_ID || process.env.ELVENLABS_VOICE_ID || "").trim()
    || ELEVENLABS_DEFAULT_VOICE;

  // ElevenLabs ids are 20 characters of base62; anything that shape is an id.
  if (/^[A-Za-z0-9]{20}$/.test(configured)) return { id: configured };

  // A premade name resolves from the table, so a key scoped to text-to-speech
  // alone — one that may not read the voice list — still works.
  const premade = getElevenLabsVoiceIdByName(configured);
  if (premade) return { id: premade };

  const wanted = configured.toLowerCase();
  const remembered = elevenLabsVoiceIds.get(wanted);
  if (remembered) return { id: remembered };

  const voices = await listElevenLabsVoices(apiKey);
  if ("error" in voices) return voices;

  const match = voices.voices.find((voice) => voice.name?.trim().toLowerCase() === wanted);
  if (!match?.voice_id) {
    return {
      error: `ElevenLabs не знает голос «${configured}». Выберите другой в настройках.`,
      status: 400,
    };
  }

  elevenLabsVoiceIds.set(wanted, match.voice_id);
  return { id: match.voice_id };
}

async function listElevenLabsVoices(
  apiKey: string,
): Promise<{ voices: ElevenLabsVoice[] } | { error: string; status: number }> {
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`ElevenLabs voice list failed (${response.status}):`, err);
    if (response.status === 401) {
      // Distinct from a TTS 401: the key works, it just may not read voices.
      return {
        error: "Ключу ElevenLabs не разрешено читать список голосов (нужно право voices_read).",
        status: 401,
      };
    }
    return { error: `Не удалось получить список голосов ElevenLabs (${response.status}).`, status: 502 };
  }

  const payload = await response.json() as { voices?: ElevenLabsVoice[] };
  return { voices: payload.voices ?? [] };
}

/**
 * Synthesise through ElevenLabs.
 *
 * Raw PCM is asked for rather than MP3: the player can schedule those samples
 * directly, where MP3 has to go through the browser's decoder first. The raw
 * formats above 24 kHz sit behind a Pro plan, so a refusal falls back to MP3
 * rather than leaving the card silent.
 */
async function speakWithElevenLabs(
  text: string,
  lang: string,
  fresh: boolean,
  requestedVoice?: string,
  requestedModel?: string,
): Promise<Spoken> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) return { error: "Missing ElevenLabs API key", status: 500 };

  const voice = await resolveElevenLabsVoice(apiKey, requestedVoice);
  if ("error" in voice) return voice;

  const model = getElevenLabsModel(requestedModel);
  // Flash and Turbo 2.5 can be told the language; the others read it off the
  // text, which is how a German "so" ends up read as English.
  const languageCode = getElevenLabsLanguageCode(model, lang);
  const cacheVoiceKey = `${model}:${voice.id}`;
  // A recording told which language to use belongs to that language. Only the
  // models that take no such hint still share the language-less "und" rows.
  const cacheLang = languageCode ?? "und";
  const cached = fresh ? null : await sbGetCachedTts(text, cacheLang, cacheVoiceKey);
  if (cached) {
    return { audioBase64: cached, source: "db_cache", sampleRate: ELEVENLABS_PCM_SAMPLE_RATE };
  }

  const body = JSON.stringify({
    text,
    model_id: model,
    ...(languageCode ? { language_code: languageCode } : {}),
    // Steady enough to be a reference, expressive enough not to drone; speaker
    // boost keeps the opening consonant from being swallowed.
    voice_settings: {
      stability: 0.55,
      similarity_boost: 0.8,
      style: 0.15,
      use_speaker_boost: true,
      speed: 1.0,
    },
  });

  const speak = (format: string) => fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}?output_format=${format}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body,
    },
  );

  let format: "pcm" | "mp3" = "pcm";
  let response = await speak(ELEVENLABS_PCM_FORMAT);

  if (!response.ok && (response.status === 400 || response.status === 403 || response.status === 422)) {
    // Raw PCM is plan-gated; MP3 is not, and a decoded card beats a silent one.
    const err = await response.text();
    console.warn(`ElevenLabs refused ${ELEVENLABS_PCM_FORMAT} (${response.status}), retrying as MP3:`, err);
    response = await speak(ELEVENLABS_MP3_FORMAT);
    format = "mp3";
  }

  if (!response.ok) {
    const err = await response.text();
    console.error(`ElevenLabs TTS API error (${response.status}, voice=${voice.id}, model=${model}):`, err);
    if (response.status === 401) {
      return { error: "ElevenLabs не принял ключ. Проверьте ELEVENLABS_API_KEY.", status: 401 };
    }
    if (response.status === 429) {
      return { error: "ElevenLabs ограничил запросы. Проверьте остаток символов.", status: 429 };
    }
    if (/model/i.test(err)) {
      return { error: `ElevenLabs не знает модель «${model}». Проверьте ELEVENLABS_MODEL_ID.`, status: 400 };
    }
    return { error: "ElevenLabs TTS failed", status: response.status };
  }

  const audioBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
  if (!audioBase64) return { error: "ElevenLabs returned no audio", status: 502 };

  if (format === "mp3") {
    // MP3 rows would be read back as PCM; keep them out of the shared cache.
    return { audioBase64, source: "api", format: "mp3" };
  }

  await sbSaveCachedTts(text, cacheLang, cacheVoiceKey, audioBase64);
  return { audioBase64, source: "api", sampleRate: ELEVENLABS_PCM_SAMPLE_RATE };
}

/**
 * The OpenAI credentials, under either name.
 *
 * The deployment names them GPT_API_KEY / GPT_VOICE_ID; OPENAI_* is accepted
 * too, so a machine that already carries the conventional names works without
 * a second copy of the same secret.
 */
function getOpenAiApiKey() {
  return (process.env.GPT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
}

function getOpenAiVoiceId() {
  const configured = (process.env.GPT_VOICE_ID || process.env.OPENAI_VOICE_ID || "").trim();
  return configured ? normalizeOpenAiVoice(configured) : OPENAI_DEFAULT_VOICE;
}

/**
 * Synthesise through OpenAI's gpt-4o-mini-tts.
 *
 * The model reads the language out of the text itself — there is no locale to
 * pass — so every deck can use it. It answers with the audio bytes directly
 * rather than JSON, and MP3 is asked for because the player already decodes
 * that shape for Inworld.
 */
async function speakWithOpenAi(
  text: string,
  lang: string,
  fresh: boolean,
  requestedVoice?: string,
  requestedModel?: string,
): Promise<Spoken> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return { error: "Missing OpenAI API key", status: 500 };

  const voiceId = requestedVoice ? normalizeOpenAiVoice(requestedVoice) : getOpenAiVoiceId();
  // Switching the voice must not serve the previous one out of the cache, and
  // neither must changing how it is told to read: "teacher" marks the delivery
  // this key was recorded with, and the version marks which wording of it.
  const language = normalizeLanguageCode(lang);
  const cacheVoiceKey = `${OPENAI_TTS_MODEL}:${voiceId}:teacher:${SPEECH_STYLE_VERSION}`;

  const cached = fresh ? null : await sbGetCachedTts(text, language, cacheVoiceKey);
  if (cached) return { audioBase64: cached, source: "db_cache", format: "mp3" };

  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_TTS_MODEL,
      input: text,
      voice: voiceId,
      // gpt-4o-mini-tts takes direction in plain words, and reads a shade
      // slower than a learner following along wants.
      instructions: teacherInstructions(lang),
      speed: OPENAI_SPEAKING_RATE,
      response_format: "mp3",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`OpenAI TTS API error (${response.status}, voice=${voiceId}):`, err);
    if (response.status === 401 || response.status === 403) {
      return { error: "OpenAI не принял ключ. Проверьте GPT_API_KEY.", status: response.status };
    }
    if (response.status === 429) {
      return { error: "OpenAI ограничил запросы. Проверьте баланс аккаунта.", status: 429 };
    }
    if (response.status === 400 && /voice/i.test(err)) {
      return {
        error: `OpenAI не знает голос «${voiceId}». Допустимые: ${OPENAI_VOICES.join(", ")}.`,
        status: 400,
      };
    }
    return { error: "OpenAI TTS failed", status: response.status };
  }

  const audioBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
  if (!audioBase64) return { error: "OpenAI returned no audio", status: 502 };

  await sbSaveCachedTts(text, language, cacheVoiceKey, audioBase64);
  return { audioBase64, source: "api", format: "mp3" };
}

/**
 * Synthesise through Inworld.
 *
 * Inworld hands back base64 MP3 rather than the raw PCM the other providers
 * emit, so the format is reported alongside the audio and the player decodes it
 * with the browser's own decoder. MP3 also means the cache stores exactly what
 * the API returned — no header to strip, no sample rate to carry.
 */
async function speakWithInworld(text: string, lang: string, fresh: boolean, locale: string): Promise<Spoken> {
  const apiKey = process.env.INWORLD_API_KEY;
  if (!apiKey) return { error: "Missing Inworld API key", status: 500 };

  const voiceId = process.env.INWORLD_VOICE_ID || INWORLD_DEFAULT_VOICE;
  // Voice and language both shape the recording, so both belong in the key.
  const cacheVoiceKey = `${INWORLD_MODEL}:${voiceId}`;
  const language = normalizeLanguageCode(lang);

  const cached = fresh ? null : await sbGetCachedTts(text, language, cacheVoiceKey);
  if (cached) return { audioBase64: cached, source: "db_cache", format: "mp3" };

  const response = await fetch("https://api.inworld.ai/tts/v1/voice", {
    method: "POST",
    headers: {
      // Accept either the Base64 signature alone or a full "Basic …" value.
      "Authorization": getInworldAuthorizationHeader(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voiceId,
      modelId: INWORLD_MODEL,
      audioConfig: { audioEncoding: "MP3", speakingRate: 1 },
      deliveryMode: "BALANCED",
      language: locale,
      applyTextNormalization: "ON",
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    console.error(`Inworld TTS API error (${response.status}, voice=${voiceId}, locale=${locale}):`, err);
    if (response.status === 401 || response.status === 403) {
      return { error: "Inworld не принял ключ. Проверьте INWORLD_API_KEY.", status: response.status };
    }
    if (response.status === 429) {
      return { error: "Inworld ограничил запросы. Проверьте баланс кредитов.", status: 429 };
    }
    if (/voice/i.test(err) && response.status === 400) {
      return { error: `Inworld не знает голос «${voiceId}». Выберите другой в разделе Voices.`, status: 400 };
    }
    return { error: "Inworld TTS failed", status: response.status };
  }

  const data = await response.json() as { audioContent?: string };
  if (!data.audioContent) return { error: "Inworld returned no audio", status: 502 };

  await sbSaveCachedTts(text, language, cacheVoiceKey, data.audioContent);
  return { audioBase64: data.audioContent, source: "api", format: "mp3" };
}

/**
 * Synthesise through Speechify Simba.
 *
 * Speechify chooses its own sample rate per model, and the player has to be
 * told which one — so the WAV goes into the cache with its header intact and
 * gets parsed on the way out. A cache hit and a fresh call then answer with the
 * same rate, instead of a cached card playing at the wrong pitch.
 */
async function speakWithSpeechify(text: string, lang: string, fresh: boolean, locale: string): Promise<Spoken> {
  const apiKey = process.env.SPEECHIFY_API_KEY;
  const voiceId = process.env.SPEECHIFY_VOICE_ID;
  if (!apiKey || !voiceId) return { error: "Missing Speechify configuration", status: 500 };

  const model = getSpeechifyModel(lang);
  // The voice is part of the identity of the recording: switching voices must
  // not serve the old one out of the cache.
  const cacheVoiceKey = `${model}:${voiceId}`;
  const language = normalizeLanguageCode(lang);

  const cachedWav = fresh ? null : await sbGetCachedTts(text, language, cacheVoiceKey);
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
async function speakWithDeepgram(text: string, lang: string, fresh: boolean, model: string): Promise<Spoken> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return { error: "Missing Deepgram API key", status: 500 };

  const language = normalizeLanguageCode(lang);
  const cachedAudio = fresh ? null : await sbGetCachedTts(text, language, model);
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
