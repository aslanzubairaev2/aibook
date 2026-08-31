import { readTranscriptCache, writeTranscriptCache } from "./transcriptCacheServer";

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
const SUPADATA_URL = "https://api.supadata.ai/v1/transcript";

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
};

type SupadataCue = {
  text?: string;
  offset?: number;
  duration?: number;
};

type SupadataResponse = {
  content?: SupadataCue[];
  jobId?: string;
  status?: string;
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
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": TIMEDTEXT_USER_AGENT },
  });
  if (!response.ok) return [];
  return parseTranscriptXml(await response.text());
}

async function getWatchPageCaptionTracks(videoId: string, preferredLang: string): Promise<CaptionTrack[]> {
  const response = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=${encodeURIComponent(preferredLang)}`, {
    signal: AbortSignal.timeout(10000),
    headers: {
      "User-Agent": WATCH_PAGE_USER_AGENT,
      "Accept-Language": `${preferredLang},en;q=0.8`,
    },
  });
  if (!response.ok) return [];
  const playerResponse = extractJsonObject(await response.text(), "ytInitialPlayerResponse = ");
  return getCaptionTracks(playerResponse);
}

function supadataApiKey(): string | null {
  return process.env.SUPADATA_API_KEY || null;
}

function parseSupadataCues(data: SupadataResponse): SubtitleCue[] {
  return normalizeSubtitleCues((data.content || [])
    .filter((cue) => typeof cue.text === "string" && typeof cue.offset === "number" && typeof cue.duration === "number")
    .map((cue) => ({
      start: (cue.offset as number) / 1000,
      end: ((cue.offset as number) + (cue.duration as number)) / 1000,
      duration: (cue.duration as number) / 1000,
      text: decodeHtml((cue.text as string).trim()),
    }))
    .filter((cue) => cue.text.length > 0));
}

export type TranscriptResult =
  | { status: "completed"; cues: SubtitleCue[] }
  | { status: "pending"; jobId: string }
  | { status: "unavailable"; cues: SubtitleCue[] };

export class TranscriptError extends Error {
  retryable: boolean;
  httpStatus: number;
  constructor(message: string, retryable = true, httpStatus = 503) {
    super(message);
    this.retryable = retryable;
    this.httpStatus = httpStatus;
  }
}

// Only native subtitle requests can create entries in this map.
const nativeJobs = new Map<string, string>();
const transcriptCache = new Map<string, SubtitleCue[]>();

/** One bounded network step; the browser keeps polling the SAME job until it finishes. */
const inFlight = new Map<string, Promise<TranscriptResult>>();
export async function getTranscriptResult(videoId: string, preferredLang = "de", savedJobId?: string): Promise<TranscriptResult> {
  const id = `${videoId}:${preferredLang}`;
  const active = inFlight.get(id);
  if (active) return active;
  const request = fetchTranscriptStep(videoId, preferredLang, savedJobId);
  inFlight.set(id, request);
  try { return await request; } finally { inFlight.delete(id); }
}

async function fetchTranscriptStep(videoId: string, preferredLang: string, savedJobId?: string): Promise<TranscriptResult> {
  const cacheKey = `${videoId}:${preferredLang}`;
  const cached = transcriptCache.get(cacheKey);
  if (cached) return { status: "completed", cues: cached };
  let persisted: SubtitleCue[] | null;
  try { persisted = await readTranscriptCache(videoId, preferredLang); }
  catch (error) { throw new TranscriptError(error instanceof Error ? error.message : "Кэш субтитров недоступен."); }
  if (persisted) {
    transcriptCache.set(cacheKey, persisted);
    return { status: "completed", cues: persisted };
  }
  const key = supadataApiKey();
  const jobId = savedJobId || nativeJobs.get(cacheKey);
  let cues: SubtitleCue[];

  if (key) {
    const params = new URLSearchParams({
      url: `https://www.youtube.com/watch?v=${videoId}`,
      lang: preferredLang, text: "false", mode: "native",
    });
    const response = await fetch(jobId ? `${SUPADATA_URL}/${encodeURIComponent(jobId)}` : `${SUPADATA_URL}?${params}`, {
      headers: { "x-api-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    }).catch(() => {
      throw new TranscriptError(
        jobId ? "Ответ Supadata задерживается. Продолжаем проверять задание…"
          : "Не получен номер задания Supadata. Автоповтор остановлен, чтобы не тратить кредиты повторно. Попробуйте позже.",
        Boolean(jobId), jobId ? 503 : 422,
      );
    });
    if (response.status === 206) {
      nativeJobs.delete(cacheKey);
      return { status: "unavailable", cues: [] };
    }
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({})) as { details?: string; message?: string };
      const quotaExceeded = response.status === 429 && /plan usage limit|quota|credits|balance/i.test(errorData.details || "");
      const retryable = !quotaExceeded && (response.status === 429 || (Boolean(jobId) && response.status >= 500));
      if (!retryable) nativeJobs.delete(cacheKey);
      throw new TranscriptError(
        quotaExceeded ? "Исчерпан лимит Supadata. Субтитры станут доступны после обновления квоты. AI-генерация отключена."
          : response.status === 404 && jobId ? "Срок хранения задания истёк. Повторите загрузку субтитров."
          : response.status === 429 ? "Supadata временно ограничил запросы. Продолжаем ожидание…"
          : "Не удалось получить субтитры от Supadata.",
        retryable, retryable ? 503 : 422,
      );
    }
    const data = await response.json() as SupadataResponse;
    if (data.status === "failed" || data.status === "error") {
      nativeJobs.delete(cacheKey);
      throw new TranscriptError("Supadata не смог получить субтитры. Генерация отключена.", false, 422);
    }
    const activeJobId = data.jobId || jobId;
    if (data.status === "queued" || data.status === "active" || (data.jobId && !data.content && data.status !== "completed")) {
      if (!activeJobId) throw new TranscriptError("Supadata не вернул номер задания.");
      nativeJobs.set(cacheKey, activeJobId);
      return { status: "pending", jobId: activeJobId };
    }
    if (!Array.isArray(data.content)) throw new TranscriptError("Supadata вернул некорректный ответ.");
    cues = parseSupadataCues(data);
    nativeJobs.delete(cacheKey);
  } else {
    // These fallbacks only read existing YouTube caption tracks, never generate audio text.
    const res = await fetch(INNERTUBE_PLAYER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/json", "User-Agent": INNERTUBE_USER_AGENT },
      body: JSON.stringify({ context: { client: { clientName: "ANDROID", clientVersion: INNERTUBE_CLIENT_VERSION } }, videoId }),
    });
    const primaryTrack = res.ok ? selectCaptionTrack(getCaptionTracks(await res.json()), preferredLang) : null;
    cues = primaryTrack ? await downloadTranscript(primaryTrack) : [];
    if (!cues.length) {
      const track = selectCaptionTrack(await getWatchPageCaptionTracks(videoId, preferredLang), preferredLang);
      cues = track ? await downloadTranscript(track) : [];
    }
  }
  if (!cues.length) return { status: "unavailable", cues: [] };
  transcriptCache.set(cacheKey, cues);
  // A cache write failure must not discard subtitles we have already paid for.
  try { await writeTranscriptCache(videoId, preferredLang, cues); }
  catch { console.error("Transcript cache write failed; returning cues for browser persistence.", { videoId }); }
  return { status: "completed", cues };
}

/** Search enrichment is best-effort and must not hold a serverless function open. */
export async function fetchYouTubeTranscript(videoId: string, preferredLang = "de"): Promise<SubtitleCue[]> {
  try {
    const result = await getTranscriptResult(videoId, preferredLang);
    return result.status === "completed" ? result.cues : [];
  } catch {
    return [];
  }
}
