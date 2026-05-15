import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { text, lang } = await req.json();
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ error: "Missing API key" }, { status: 500 });
    }

    // Determine voice based on language or just use a default.
    // "Kore", "Aoede", "Puck", "Charon", "Fenrir"
    const voiceName = "Kore"; 

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text }]
          }
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

    if (!response.ok) {
      const err = await response.text();
      console.error("Gemini TTS API error:", err);
      return NextResponse.json({ error: "TTS failed" }, { status: response.status });
    }

    const data = await response.json();
    const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    
    if (inlineData?.data) {
      return NextResponse.json({ audioBase64: inlineData.data });
    }

    return NextResponse.json({ error: "No audio data received" }, { status: 500 });
  } catch (error) {
    console.error("TTS Error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
