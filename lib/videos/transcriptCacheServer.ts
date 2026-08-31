import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { isSubtitleCues } from "./subtitleCues";
import type { SubtitleCue } from "./youtubeTranscript";

/** Shared, durable cache. Read failures are NOT misses: do not spend credits blindly. */
export async function readTranscriptCache(videoId: string, language: string): Promise<SubtitleCue[] | null> {
  if (!supabaseAdmin) throw new Error("Серверный кэш субтитров не настроен. Запрос Supadata не отправлен.");
  const { data, error } = await supabaseAdmin.from("youtube_transcripts")
    .select("cues").eq("video_id", videoId).eq("language", language)
    .abortSignal(AbortSignal.timeout(5000)).maybeSingle();
  if (error) throw new Error("Кэш субтитров временно недоступен. Ожидаем восстановление…");
  if (!data) return null;
  if (!isSubtitleCues(data.cues)) throw new Error("Сохранённые субтитры повреждены. Повторный платный запрос не отправлен.");
  return data.cues;
}

export async function writeTranscriptCache(videoId: string, language: string, cues: SubtitleCue[]): Promise<void> {
  if (!isSubtitleCues(cues)) return; // Never replace valid subtitles with an empty/error response.
  if (!supabaseAdmin) throw new Error("Transcript cache is not configured.");
  const { error } = await supabaseAdmin.from("youtube_transcripts").upsert({
    video_id: videoId, language, cues,
  }, { onConflict: "video_id,language" }).abortSignal(AbortSignal.timeout(5000));
  if (error) throw new Error("Transcript cache write failed.");
}
