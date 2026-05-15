import { NextResponse } from "next/server";
import { sbGetCachedTts, sbSaveCachedTts } from "@/lib/db/supabase";

export async function POST(req: Request) {
  try {
    const { text, lang } = await req.json();
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
