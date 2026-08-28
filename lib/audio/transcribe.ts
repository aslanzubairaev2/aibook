import type { AudiobookSegment, AudiobookTranscript, AudiobookWordTimestamp } from "../types.ts";

const LOCAL_TRANSCRIPT_PREFIX = "aibook_audiobook_transcript_";

/**
 * Finds the index of the segment currently playing at `currentTime` (in seconds).
 */
export function findActiveSegmentIndex(
  segments: AudiobookSegment[],
  currentTime: number
): number {
  if (!segments || segments.length === 0) return -1;

  // Direct hit
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (currentTime >= seg.start && currentTime <= seg.end) {
      return i;
    }
  }

  // If in a small pause between segments, find the most recent segment that started before currentTime
  let bestIdx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start <= currentTime) {
      bestIdx = i;
    } else {
      break;
    }
  }

  return bestIdx;
}

/**
 * Finds the active word index within a segment at `currentTime` (in seconds).
 */
export function findActiveWordIndex(
  words: AudiobookWordTimestamp[] | undefined,
  currentTime: number
): number {
  if (!words || words.length === 0) return -1;
  for (let i = 0; i < words.length; i++) {
    if (currentTime >= words[i].start && currentTime <= words[i].end) {
      return i;
    }
  }
  return -1;
}

/**
 * Validates and normalizes raw segment data received from AI or database.
 */
export function normalizeSegments(raw: unknown[]): AudiobookSegment[] {
  if (!Array.isArray(raw)) return [];

  const segments: AudiobookSegment[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") continue;

    const rawObj = item as Record<string, unknown>;
    const text = typeof rawObj.text === "string" ? rawObj.text.trim() : "";
    if (!text) continue;

    let start = Number(rawObj.start);
    let end = Number(rawObj.end);

    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end < start) end = start + Math.max(1, text.length * 0.08);

    let words: AudiobookWordTimestamp[] | undefined;
    if (Array.isArray(rawObj.words)) {
      words = [];
      for (const w of rawObj.words) {
        if (!w || typeof w !== "object") continue;
        const wObj = w as Record<string, unknown>;
        const wText = typeof wObj.word === "string" ? wObj.word.trim() : "";
        if (!wText) continue;
        let wStart = Number(wObj.start);
        let wEnd = Number(wObj.end);
        if (isNaN(wStart)) wStart = start;
        if (isNaN(wEnd)) wEnd = wStart + 0.3;
        words.push({ word: wText, start: wStart, end: wEnd });
      }
    }

    segments.push({
      id: typeof rawObj.id === "string" ? rawObj.id : `seg-${i + 1}`,
      start,
      end,
      text,
      words: words && words.length > 0 ? words : undefined,
    });
  }

  // Sort by start timestamp
  return segments.sort((a, b) => a.start - b.start);
}

/**
 * Local storage key for transcript caching.
 */
export function getLocalTranscriptKey(audiobookId: string, chapterIndex: number): string {
  return `${LOCAL_TRANSCRIPT_PREFIX}${audiobookId}_ch${chapterIndex}`;
}

/**
 * Retrieves a cached transcript from localStorage.
 */
export function getLocalTranscript(
  audiobookId: string,
  chapterIndex: number
): AudiobookTranscript | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(getLocalTranscriptKey(audiobookId, chapterIndex));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AudiobookTranscript;
    if (parsed && Array.isArray(parsed.segments)) {
      return parsed;
    }
  } catch (e) {
    console.warn("Failed to parse local transcript cache:", e);
  }
  return null;
}

/**
 * Saves a transcript to localStorage.
 */
export function saveLocalTranscript(transcript: AudiobookTranscript): void {
  if (typeof window === "undefined" || !transcript) return;
  try {
    localStorage.setItem(
      getLocalTranscriptKey(transcript.audiobookId, transcript.chapterIndex),
      JSON.stringify(transcript)
    );
  } catch (e) {
    console.warn("Failed to write to local transcript cache:", e);
  }
}

export type FetchTranscriptParams = {
  audiobookId: string;
  chapterIndex: number;
  audioUrl: string;
  language: string;
  duration?: number;
};

// Gemini transcription is a paid, ~minute-long call. Two callers racing for
// the same chapter (React effect double-invoke in dev, a double-click, the
// chapter list and the read-along view mounting at once) must not turn into
// two paid requests — they share this one in-flight promise instead.
const inFlightRequests = new Map<string, Promise<AudiobookTranscript>>();

/**
 * Fetches or transcribes an audiobook chapter.
 * Checks local cache first, then calls the backend `/api/audiobooks/transcribe`.
 */
export async function fetchAudiobookTranscript(
  params: FetchTranscriptParams
): Promise<AudiobookTranscript> {
  const { audiobookId, chapterIndex, audioUrl, language, duration } = params;

  // 1. Check local cache (only accept if it has word-level timestamps)
  const cached = getLocalTranscript(audiobookId, chapterIndex);
  if (
    cached &&
    cached.segments &&
    cached.segments.length > 0 &&
    cached.segments.some((s) => s.words && s.words.length > 0)
  ) {
    return cached;
  }

  const requestKey = getLocalTranscriptKey(audiobookId, chapterIndex);
  const inFlight = inFlightRequests.get(requestKey);
  if (inFlight) return inFlight;

  const requestPromise = (async () => {
    // 2. Fetch real Gemini AI transcription from backend API
    const { getAiHeaders } = await import("@/lib/ai/analyze");
    const headers = await getAiHeaders();
    const res = await fetch("/api/audiobooks/transcribe", {
      method: "POST",
      headers,
      body: JSON.stringify({
        audiobookId,
        chapterIndex,
        audioUrl,
        language,
        duration,
      }),
    });

    if (!res.ok) {
      let errMsg = `Transcription request failed (${res.status})`;
      try {
        const errJson = await res.json();
        if (errJson.error) errMsg = errJson.error;
      } catch {
        // fallback
      }
      throw new Error(errMsg);
    }

    const data = (await res.json()) as AudiobookTranscript;
    if (!data || !Array.isArray(data.segments)) {
      throw new Error("Invalid transcript response format from server");
    }

    // 3. Save to local cache
    saveLocalTranscript(data);
    return data;
  })();

  inFlightRequests.set(requestKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    // Only a rejected/completed request leaves the map — a fresh retry after
    // a failure must be able to start a new request, not replay the old one.
    inFlightRequests.delete(requestKey);
  }
}
