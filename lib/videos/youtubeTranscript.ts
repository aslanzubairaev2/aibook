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
    const data = await res.json();
    const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!Array.isArray(tracks) || tracks.length === 0) {
      return [];
    }

    // Find best matching track (matching language or default first)
    const track =
      tracks.find((t: { languageCode: string }) =>
        t.languageCode?.toLowerCase().startsWith(preferredLang.toLowerCase())
      ) || tracks[0];

    if (!track?.baseUrl) return [];

    const cRes = await fetch(track.baseUrl, {
      headers: {
        "User-Agent": TIMEDTEXT_USER_AGENT,
      },
    });

    if (!cRes.ok) return [];
    const xml = await cRes.text();
    const cues = parseTranscriptXml(xml);

    if (cues.length > 0) {
      transcriptCache.set(cacheKey, cues);
    }

    return cues;
  } catch (err) {
    console.error(`fetchYouTubeTranscript error for ${videoId}:`, err);
    return [];
  }
}
