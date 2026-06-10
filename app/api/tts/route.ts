import { NextResponse } from "next/server";
import { sbGetCachedTts, sbSaveCachedTts } from "@/lib/db/supabase";
import { DEEPGRAM_TTS_SAMPLE_RATE, getDeepgramTtsModel, normalizeLanguageCode } from "@/lib/ttsProviders";
import { getUserFromRequest } from "@/lib/auth/serverUser";

const MAX_TTS_TEXT_LENGTH = 2000;

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
      provider?: "gemini" | "deepgram";
    };

    if (!text || typeof text !== "string") {
      return NextResponse.json({ error: "Missing text" }, { status: 400 });
    }
    if (text.length > MAX_TTS_TEXT_LENGTH) {
      return NextResponse.json({ error: `TTS text exceeds ${MAX_TTS_TEXT_LENGTH} character limit` }, { status: 413 });
    }

    if (provider === "deepgram") {
      const apiKey = process.env.DEEPGRAM_API_KEY;
      const model = getDeepgramTtsModel(lang);

      if (!model) {
        return NextResponse.json({ error: "Deepgram TTS does not support this language" }, { status: 400 });
      }

      if (!apiKey) {
        return NextResponse.json({ error: "Missing Deepgram API key" }, { status: 500 });
      }

      if (text.length > 2000) {
        return NextResponse.json({ error: "Deepgram TTS text exceeds 2000 character limit" }, { status: 413 });
      }

      const language = normalizeLanguageCode(lang);
      const cachedAudio = await sbGetCachedTts(text, language, model);
      if (cachedAudio) {
        return NextResponse.json({ audioBase64: cachedAudio, source: "db_cache", provider, model });
      }

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
        return NextResponse.json({ error: "Deepgram TTS failed" }, { status: response.status });
      }

      const audioBase64 = Buffer.from(await response.arrayBuffer()).toString("base64");
      await sbSaveCachedTts(text, language, model, audioBase64);
      return NextResponse.json({ audioBase64, source: "api", provider, model });
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
      return await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`, {
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
