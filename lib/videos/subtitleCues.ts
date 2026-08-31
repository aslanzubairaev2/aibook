import type { SubtitleCue } from "./youtubeTranscript";

export function isSubtitleCues(value: unknown): value is SubtitleCue[] {
  return Array.isArray(value) && value.length > 0 && value.every(cue =>
    cue && typeof cue.text === "string" && cue.text.trim().length > 0
    && Number.isFinite(cue.start) && cue.start >= 0
    && Number.isFinite(cue.end) && cue.end > cue.start
    && Number.isFinite(cue.duration) && cue.duration > 0);
}
