import { NextResponse } from "next/server";
import { fetchYouTubeTranscript } from "@/lib/videos/youtubeTranscript";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v");
  const lang = searchParams.get("lang") || "de";

  if (!videoId) {
    return NextResponse.json({ error: "Missing videoId (v)" }, { status: 400 });
  }

  try {
    const cues = await fetchYouTubeTranscript(videoId, lang);
    return NextResponse.json({
      videoId,
      language: lang,
      total: cues.length,
      cues,
    });
  } catch (err) {
    console.error("API /api/videos/transcript error:", err);
    return NextResponse.json({ error: "Failed to fetch transcript" }, { status: 500 });
  }
}
