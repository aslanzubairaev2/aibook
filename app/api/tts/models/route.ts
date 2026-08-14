// GET /api/tts/models?provider=… — the speech models this engine offers.
//
// Every list here is asked of the provider itself rather than written down from
// memory: model ids drift (Cartesia's sonic-2 was current for about a week of
// this app's life), and a stale hardcoded list is worse than no list at all.
// Cartesia is the exception and says so in the response — it publishes no model
// listing endpoint, so its entries are named here and marked as such.
//
// On price: none of these APIs return a per-character price in money. Only
// ElevenLabs states a relative cost, as a multiplier against your character
// quota, and that is passed through exactly as given when it is present. No
// figure is invented for the others — a made-up price is worse than a blank.

import { NextResponse } from "next/server";
import {
  CARTESIA_MODEL,
  GEMINI_TTS_MODEL,
  normalizeLanguageCode,
  normalizeTtsProvider,
  type TtsModelOption,
} from "@/lib/ttsProviders";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

type ModelList = { models: TtsModelOption[]; note?: string } | { error: string; status: number };

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const provider = normalizeTtsProvider(params.get("provider"));
  const lang = params.get("lang") ?? "";

  try {
    const result = await listModels(provider, lang);
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ provider, ...result });
  } catch (error) {
    console.error(`${provider} model list threw:`, error);
    return NextResponse.json({ error: "Не удалось получить список моделей." }, { status: 502 });
  }
}

async function listModels(provider: string, lang: string): Promise<ModelList> {
  if (provider === "elevenlabs") return listElevenLabsModels(lang);
  if (provider === "openai") return listOpenAiModels();
  if (provider === "gemini") return listGeminiModels();
  if (provider === "cartesia") return listCartesiaModels();
  // The rest choose their model from the language, so there is nothing to pick.
  return { models: [] };
}

/** ElevenLabs publishes its models, and with them the only real cost figure. */
async function listElevenLabsModels(lang: string): Promise<ModelList> {
  const apiKey = (process.env.ELEVENLABS_API_KEY || process.env.ELVENLABS_API_KEY || "").trim();
  if (!apiKey) return { error: "Не задан ключ ElevenLabs (ELEVENLABS_API_KEY).", status: 500 };

  const response = await fetch("https://api.elevenlabs.io/v1/models", {
    headers: { "xi-api-key": apiKey },
  });
  if (!response.ok) {
    const err = await response.text();
    console.error(`ElevenLabs model list failed (${response.status}):`, err);
    if (response.status === 401) {
      return { error: "Ключу ElevenLabs не разрешено читать список моделей (право models_read).", status: 401 };
    }
    return { error: `ElevenLabs вернул ошибку ${response.status}.`, status: 502 };
  }

  const payload = await response.json() as unknown;
  const raw = Array.isArray(payload)
    ? payload as Record<string, unknown>[]
    : ((payload as { models?: Record<string, unknown>[] })?.models ?? []);

  const wanted = normalizeLanguageCode(lang);

  const models = raw
    .filter((model) => model.can_do_text_to_speech !== false)
    // Flash v2 and Turbo v2 are English-only, and offering them for a German
    // deck is offering a model that will mispronounce every word of it. The
    // listing states each model's languages, so honour it — but only when it
    // actually says: an absent list is not a claim that the model is narrow.
    .filter((model) => {
      const languages = model.languages;
      if (!wanted || !Array.isArray(languages) || languages.length === 0) return true;
      return languages.some((entry) => {
        const id = (entry as { language_id?: unknown })?.language_id;
        return typeof id === "string" && normalizeLanguageCode(id) === wanted;
      });
    })
    .map((model) => {
      // The rate object is read only if it is actually there and numeric; an
      // absent one leaves the price blank rather than filled with a guess.
      const rates = model.model_rates as { character_cost_multiplier?: unknown } | undefined;
      const multiplier = typeof rates?.character_cost_multiplier === "number"
        ? rates.character_cost_multiplier
        : undefined;

      return {
        id: String(model.model_id ?? ""),
        name: String(model.name ?? model.model_id ?? ""),
        description: typeof model.description === "string" ? model.description : undefined,
        costMultiplier: multiplier,
      };
    })
    .filter((model) => model.id);

  return { models };
}

/** OpenAI lists everything it serves; the speech models are the tts ones. */
async function listOpenAiModels(): Promise<ModelList> {
  const apiKey = (process.env.GPT_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { error: "Не задан ключ OpenAI (GPT_API_KEY).", status: 500 };

  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { "Authorization": `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    console.error(`OpenAI model list failed (${response.status}):`, await response.text());
    return { error: `OpenAI вернул ошибку ${response.status}.`, status: 502 };
  }

  const payload = await response.json() as { data?: { id?: string }[] };
  const models = (payload.data ?? [])
    .map((model) => String(model.id ?? ""))
    .filter((id) => id.includes("tts"))
    .sort()
    .map((id) => ({ id, name: id }));

  return { models, note: "Цену OpenAI через API не отдаёт." };
}

/** Gemini's model listing states which methods each one supports. */
async function listGeminiModels(): Promise<ModelList> {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { error: "Не задан ключ Gemini (GEMINI_API_KEY).", status: 500 };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`,
  );
  if (!response.ok) {
    console.error(`Gemini model list failed (${response.status}):`, await response.text());
    return { error: `Gemini вернул ошибку ${response.status}.`, status: 502 };
  }

  const payload = await response.json() as {
    models?: { name?: string; displayName?: string; description?: string }[];
  };

  const models = (payload.models ?? [])
    .map((model) => ({
      id: String(model.name ?? "").replace(/^models\//, ""),
      name: model.displayName || String(model.name ?? "").replace(/^models\//, ""),
      description: model.description,
    }))
    .filter((model) => /tts/i.test(model.id));

  // A key that cannot list still knows the model this app was built against.
  if (models.length === 0) {
    return { models: [{ id: GEMINI_TTS_MODEL, name: GEMINI_TTS_MODEL, unverified: true }] };
  }

  return { models, note: "Цену Gemini через API не отдаёт." };
}

/**
 * Cartesia has no model listing endpoint, so these are named here.
 *
 * They are marked unverified for exactly that reason: the settings screen says
 * so, and the request will fail loudly with the model's own name if one of them
 * has been retired since.
 */
function listCartesiaModels(): ModelList {
  const known = [CARTESIA_MODEL, "sonic-3", "sonic-turbo"];
  const models = [...new Set(known)].map((id) => ({ id, name: id, unverified: true }));
  return {
    models,
    note: "Cartesia не публикует список моделей — эти заданы вручную, актуальные смотрите в docs.cartesia.ai.",
  };
}
