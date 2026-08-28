export type SubtitleCue = {
  start: number; // In seconds
  end: number; // In seconds
  duration: number; // In seconds
  text: string;
};

const INNERTUBE_CLIENT_VERSION = "20.10.38";
const INNERTUBE_USER_AGENT = `com.google.android.youtube/${INNERTUBE_CLIENT_VERSION} (Linux; U; Android 14)`;
const INNERTUBE_PLAYER_URL = "https://www.youtube.com/youtubei/v1/player?prettyPrint=false";
const TIMEDTEXT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36,gzip(gfe)";
const WATCH_PAGE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
};

function decodeHtml(html: string): string {
  return html
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSubtitleCues(cues: SubtitleCue[]): SubtitleCue[] {
  return cues.map((cue, index) => {
    const nextStart = cues[index + 1]?.start;
    // YouTube often gives an auto-caption a long duration that overlaps the
    // following phrase. Showing that earlier cue through the overlap makes the
    // transcript visibly lag behind the player.
    const end = nextStart === undefined
      ? cue.end
      : Math.max(cue.start + 0.05, Math.min(cue.end, nextStart));
    return { ...cue, end, duration: end - cue.start };
  });
}

function parseTranscriptXml(xml: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];

  // Format 1: <p t="1234" d="5678">...</p>
  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m: RegExpExecArray | null;
  while ((m = pRegex.exec(xml)) !== null) {
    const startMs = parseInt(m[1], 10);
    const durMs = parseInt(m[2], 10);
    const rawText = m[3].replace(/<[^>]+>/g, "");
    const clean = decodeHtml(rawText);
    if (clean) {
      cues.push({
        start: startMs / 1000,
        end: (startMs + durMs) / 1000,
        duration: durMs / 1000,
        text: clean,
      });
    }
  }

  if (cues.length > 0) return normalizeSubtitleCues(cues);

  // Format 2: <text start="1.23" dur="4.56">...</text>
  const textRegex = /<text\s+start="([^"]+)"\s+dur="([^"]+)">([\s\S]*?)<\/text>/g;
  while ((m = textRegex.exec(xml)) !== null) {
    const start = parseFloat(m[1]);
    const dur = parseFloat(m[2]);
    const clean = decodeHtml(m[3]);
    if (clean) {
      cues.push({
        start,
        end: start + dur,
        duration: dur,
        text: clean,
      });
    }
  }

  return normalizeSubtitleCues(cues);
}

function extractJsonObject(source: string, marker: string): unknown | null {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const objectStart = source.indexOf("{", markerIndex + marker.length);
  if (objectStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(objectStart, index + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function getCaptionTracks(data: unknown): CaptionTrack[] {
  const tracks = (data as { captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } } })
    ?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  return Array.isArray(tracks) ? tracks : [];
}

function selectCaptionTrack(tracks: CaptionTrack[], preferredLang: string): CaptionTrack | null {
  return tracks.find((track) => track.languageCode?.toLowerCase().startsWith(preferredLang.toLowerCase()))
    || tracks[0]
    || null;
}

async function downloadTranscript(track: CaptionTrack): Promise<SubtitleCue[]> {
  if (!track.baseUrl) return [];
  const response = await fetch(track.baseUrl, {
    headers: { "User-Agent": TIMEDTEXT_USER_AGENT },
  });
  if (!response.ok) return [];
  return parseTranscriptXml(await response.text());
}

async function getWatchPageCaptionTracks(videoId: string, preferredLang: string): Promise<CaptionTrack[]> {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=${encodeURIComponent(preferredLang)}`, {
    headers: {
      "User-Agent": WATCH_PAGE_USER_AGENT,
      "Accept-Language": `${preferredLang},en;q=0.8`,
    },
  });
  if (!response.ok) return [];
  const playerResponse = extractJsonObject(await response.text(), "ytInitialPlayerResponse = ");
  return getCaptionTracks(playerResponse);
}

// In-memory cache for transcripts
const transcriptCache = new Map<string, SubtitleCue[]>();

export async function fetchYouTubeTranscript(
  videoId: string,
  preferredLang = "de"
): Promise<SubtitleCue[]> {
  const cacheKey = `${videoId}:${preferredLang}`;
  if (transcriptCache.has(cacheKey)) {
    return transcriptCache.get(cacheKey)!;
  }

  try {
    const res = await fetch(INNERTUBE_PLAYER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": INNERTUBE_USER_AGENT,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "ANDROID",
            clientVersion: INNERTUBE_CLIENT_VERSION,
          },
        },
        videoId,
      }),
    });

    if (!res.ok) return [];
    const data = res.ok ? await res.json() : null;
    const primaryTrack = selectCaptionTrack(getCaptionTracks(data), preferredLang);
    let cues = primaryTrack ? await downloadTranscript(primaryTrack) : [];

    // Serverless IP ranges are occasionally rejected by the Android Innertube
    // endpoint even though the public watch page still exposes caption tracks.
    // Falling back to that page keeps the transcript available on Vercel too.
    if (cues.length === 0) {
      const fallbackTrack = selectCaptionTrack(await getWatchPageCaptionTracks(videoId, preferredLang), preferredLang);
      cues = fallbackTrack ? await downloadTranscript(fallbackTrack) : [];
    }

    if (cues.length > 0) {
      transcriptCache.set(cacheKey, cues);
    }

    return cues;
  } catch (err) {
    console.error(`fetchYouTubeTranscript error for ${videoId}:`, err);
    return [];
  }
}
