import { NextResponse } from "next/server";
import { getTranscriptResult, TranscriptError } from "@/lib/videos/youtubeTranscript";

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get("v");
  const lang = searchParams.get("lang") || "de";
  const jobId = searchParams.get("job") || undefined;
  const headers = { "Cache-Control": "no-store" };

  if (!videoId || !/^[\w-]{11}$/.test(videoId) || !/^[a-zA-Z-]{2,12}$/.test(lang) || (jobId && !/^[\w-]{1,100}$/.test(jobId))) {
    return NextResponse.json({ error: "Некорректный запрос субтитров.", retryable: false }, { status: 400, headers });
  }

  try {
    const result = await getTranscriptResult(videoId, lang, jobId);
    return NextResponse.json({ videoId, language: lang, ...result }, {
      status: result.status === "pending" ? 202 : 200, headers,
    });
  } catch (err) {
    console.error("Transcript request failed", { videoId, error: err instanceof Error ? err.message : "unknown" });
    return NextResponse.json({
      error: err instanceof TranscriptError ? err.message : "Загрузка задерживается. Повторяем запрос…",
      retryable: !(err instanceof TranscriptError) || err.retryable,
    }, { status: err instanceof TranscriptError ? err.httpStatus : 503, headers });
  }
}
