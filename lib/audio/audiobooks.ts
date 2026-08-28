import type { Audiobook, AudiobookChapter, AudiobookProgress, CefrLevel } from "@/lib/types";

export type AudiobookLanguageKey = "de" | "en" | "fr" | "es" | "ru" | "it" | "all";

export const AUDIOBOOK_LANGUAGES: Record<
  AudiobookLanguageKey,
  { label: string; flag: string; iaQuery: string; defaultCode: string }
> = {
  de: {
    label: "Немецкий",
    flag: "🇩🇪",
    iaQuery: "(language:(*german* OR *ger* OR *deu* OR *de*))",
    defaultCode: "de",
  },
  en: {
    label: "Английский",
    flag: "🇬🇧",
    iaQuery: "(language:(*english* OR *eng* OR *en*))",
    defaultCode: "en",
  },
  fr: {
    label: "Французский",
    flag: "🇫🇷",
    iaQuery: "(language:(*french* OR *fre* OR *fra* OR *fr*))",
    defaultCode: "fr",
  },
  es: {
    label: "Испанский",
    flag: "🇪🇸",
    iaQuery: "(language:(*spanish* OR *spa* OR *es*))",
    defaultCode: "es",
  },
  ru: {
    label: "Русский",
    flag: "🇷🇺",
    iaQuery: "(language:(*russian* OR *rus* OR *ru*))",
    defaultCode: "ru",
  },
  it: {
    label: "Итальянский",
    flag: "🇮🇹",
    iaQuery: "(language:(*italian* OR *ita* OR *it*))",
    defaultCode: "it",
  },
  all: {
    label: "Все языки",
    flag: "🌐",
    iaQuery: "",
    defaultCode: "all",
  },
};

/** Keywords for heuristic CEFR level classification */
const CEFR_KEYWORDS = {
  A1: [
    "kinder", "fairy", "fairytales", "märchen", "children", "nursery",
    "easy", "anfänger", "beginner", "tales for children", "brüder grimm", "grimm",
  ],
  A2: [
    "short story", "kurzgeschichte", "fabel", "fabeln", "fables", "jugend", "andersen",
    "bechstein", "volksmärchen", "erzählungen für kinder",
  ],
  B1: [
    "erzählung", "abenteuer", "novelle", "reise", "adventure", "mystery", "detective",
    "zweig", "kafka", "doyle", "verne", "stifter", "storm",
  ],
  B2: [
    "roman", "fiction", "novel", "drama", "literary", "biography", "historisch",
    "fontane", "mann", "hesse", "heine", "chekhov", "tolstoy",
  ],
  C1: [
    "philosophie", "philosophy", "essays", "tragödie", "poetry", "gedichte", "klassik",
    "goethe", "schiller", "nietzsche", "kant", "schopenhauer",
  ],
  C2: [
    "faust", "kritik der reinen vernunft", "zarathustra", "metaphysik", "altdeutsch",
    "mittelhochdeutsch", "epos", "theologie",
  ],
};

export function estimateAudiobookCefr(
  title: string,
  description?: string,
  subject?: string | string[]
): CefrLevel {
  const combined = [
    title || "",
    description || "",
    Array.isArray(subject) ? subject.join(" ") : subject || "",
  ]
    .join(" ")
    .toLowerCase();

  // Priority check: A1 -> A2 -> C2 -> C1 -> B1 -> B2
  for (const kw of CEFR_KEYWORDS.A1) {
    if (combined.includes(kw)) return "A1";
  }
  for (const kw of CEFR_KEYWORDS.A2) {
    if (combined.includes(kw)) return "A2";
  }
  for (const kw of CEFR_KEYWORDS.C2) {
    if (combined.includes(kw)) return "C2";
  }
  for (const kw of CEFR_KEYWORDS.C1) {
    if (combined.includes(kw)) return "C1";
  }
  for (const kw of CEFR_KEYWORDS.B1) {
    if (combined.includes(kw)) return "B1";
  }
  for (const kw of CEFR_KEYWORDS.B2) {
    if (combined.includes(kw)) return "B2";
  }
  return "B1";
}

/** Formats seconds to mm:ss or hh:mm:ss */
export function formatAudioDuration(totalSeconds?: number): string {
  if (!totalSeconds || isNaN(totalSeconds) || totalSeconds <= 0) return "—";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours} ч ${minutes.toString().padStart(2, "0")} мин`;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Parse duration string like "03:45" or "1:02:15" or raw seconds "225" into seconds */
export function parseDurationToSeconds(val?: string | number): number {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const str = String(val).trim();
  if (/^\d+$/.test(str)) return parseInt(str, 10);

  const parts = str.split(":").map((p) => parseFloat(p) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

export type FetchAudiobooksParams = {
  language?: AudiobookLanguageKey | string;
  cefrLevel?: CefrLevel | "all";
  search?: string;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
};

export type FetchAudiobooksResult = {
  audiobooks: Audiobook[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

/** Query Internet Archive for LibriVox audiobooks */
export async function fetchAudiobooks(
  params: FetchAudiobooksParams
): Promise<FetchAudiobooksResult> {
  const {
    language = "de",
    cefrLevel = "all",
    search = "",
    page = 1,
    pageSize = 20,
    signal,
  } = params;

  const queryParts: string[] = ["collection:(librivoxaudio)"];

  // 1. Language filter
  const langConfig = AUDIOBOOK_LANGUAGES[language as AudiobookLanguageKey];
  if (langConfig && langConfig.iaQuery) {
    queryParts.push(langConfig.iaQuery);
  } else if (language && language !== "all") {
    queryParts.push(`(language:(*${language}*))`);
  }

  // 2. CEFR Level filter heuristic in query
  if (cefrLevel && cefrLevel !== "all") {
    if (cefrLevel === "A1" || cefrLevel === "A2") {
      queryParts.push(
        "(subject:(*fairy* OR *märchen* OR *fabel* OR *children* OR *tales* OR *kinder* OR *short*) OR title:(*märchen* OR *fairy* OR *fabeln* OR *geschichten*))"
      );
    } else if (cefrLevel === "B1" || cefrLevel === "B2") {
      queryParts.push("(subject:(*fiction* OR *adventure* OR *novel* OR *erzählung* OR *abenteuer*))");
    } else if (cefrLevel === "C1" || cefrLevel === "C2") {
      queryParts.push("(subject:(*classic* OR *literature* OR *philosophy* OR *drama* OR *gedichte* OR *poetry*))");
    }
  }

  // 3. User search query
  const cleanSearch = search.trim().replace(/[:^"()]/g, "");
  if (cleanSearch) {
    queryParts.push(`(title:(*${cleanSearch}*) OR creator:(*${cleanSearch}*) OR description:(*${cleanSearch}*))`);
  }

  const finalQuery = queryParts.join(" AND ");

  const urlParams = new URLSearchParams({
    q: finalQuery,
    "fl[]": "identifier,title,creator,description,language,publicdate,downloads,item_size,subject",
    "sort[]": "downloads desc",
    rows: String(pageSize),
    page: String(page),
    output: "json",
  });

  const response = await fetch(`https://archive.org/advancedsearch.php?${urlParams.toString()}`, {
    signal,
  });

  if (!response.ok) {
    throw new Error(`Internet Archive error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const docs = data?.response?.docs || [];
  const numFound = data?.response?.numFound || 0;

  const audiobooks: Audiobook[] = docs.map((doc: Record<string, unknown>) => {
    const identifier = String(doc.identifier || "");
    const title = String(doc.title || "Без названия");
    const author = String(doc.creator || "Неизвестный автор");
    const docLang = Array.isArray(doc.language) ? doc.language[0] : String(doc.language || language);
    const description = typeof doc.description === "string" ? doc.description : "";
    const subject = doc.subject as string | string[] | undefined;
    const downloads = typeof doc.downloads === "number" ? doc.downloads : 0;

    // Approximate duration: 1MB of 64kbps MP3 ≈ 131 seconds
    const itemSize = typeof doc.item_size === "number" ? doc.item_size : 0;
    const estSeconds = itemSize > 0 ? Math.round((itemSize / (1024 * 1024)) * 125) : 0;

    const estimatedLevel = cefrLevel !== "all" ? cefrLevel : estimateAudiobookCefr(title, description, subject);

    return {
      id: identifier,
      title,
      author,
      language: docLang,
      cefrLevel: estimatedLevel,
      coverUrl: identifier ? `https://archive.org/services/img/${identifier}` : null,
      description,
      totalDurationSeconds: estSeconds,
      totalDurationFormatted: formatAudioDuration(estSeconds),
      downloads,
      sourceType: "librivox",
    };
  });

  return {
    audiobooks,
    total: numFound,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(numFound / pageSize)),
  };
}

type IaFile = {
  name: string;
  title?: string;
  length?: string | number;
  track?: string | number;
  format?: string;
  creator?: string;
};

/** Fetch detailed tracklist and direct audio files for a single audiobook */
export async function fetchAudiobookDetails(
  identifier: string,
  signal?: AbortSignal
): Promise<Audiobook> {
  const res = await fetch(`https://archive.org/metadata/${identifier}`, { signal });
  if (!res.ok) {
    throw new Error(`Failed to load audiobook metadata for ${identifier}`);
  }

  const data = await res.json();
  const meta = data.metadata || {};
  const files: IaFile[] = Array.isArray(data.files) ? data.files : [];

  // Filter MP3 files, preferring 64Kbps or VBR MP3
  const mp3Files = files.filter(
    (f) =>
      f.name &&
      f.name.toLowerCase().endsWith(".mp3") &&
      (f.format === "64Kbps MP3" || f.format === "VBR MP3" || !f.format?.includes("Zip"))
  );

  // Group files by base stem to deduplicate 64kb vs 128kb versions of the same chapter
  const chapterMap = new Map<string, IaFile>();
  for (const file of mp3Files) {
    const stem = file.name.replace(/_64kb\.mp3$/i, ".mp3").toLowerCase();
    const existing = chapterMap.get(stem);
    if (!existing) {
      chapterMap.set(stem, file);
    } else if (file.format === "64Kbps MP3") {
      // Prefer 64Kbps for faster mobile streaming
      chapterMap.set(stem, file);
    }
  }

  const sortedFiles = Array.from(chapterMap.values()).sort((a, b) => {
    const trackA = parseInt(String(a.track || "0"), 10) || 0;
    const trackB = parseInt(String(b.track || "0"), 10) || 0;
    if (trackA && trackB) return trackA - trackB;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  let totalDurationSec = 0;
  const chapters: AudiobookChapter[] = sortedFiles.map((file, idx) => {
    const durationSec = parseDurationToSeconds(file.length);
    totalDurationSec += durationSec;
    const cleanTitle =
      file.title ||
      file.name
        .replace(/\.mp3$/i, "")
        .replace(/^[0-9]+[_\-\s]+/, "")
        .replace(/_/g, " ");

    return {
      id: `${identifier}_ch_${idx + 1}`,
      chapterIndex: idx,
      title: cleanTitle,
      durationSeconds: durationSec,
      durationFormatted: formatAudioDuration(durationSec),
      audioUrl: `https://archive.org/download/${identifier}/${encodeURIComponent(file.name)}`,
    };
  });

  const title = meta.title || "Без названия";
  const author = meta.creator || "Неизвестный автор";
  const description = meta.description || "";
  const language = Array.isArray(meta.language) ? meta.language[0] : meta.language || "de";
  const cefrLevel = estimateAudiobookCefr(title, description, meta.subject);

  return {
    id: identifier,
    title,
    author,
    language,
    cefrLevel,
    coverUrl: `https://archive.org/services/img/${identifier}`,
    description,
    totalDurationSeconds: totalDurationSec,
    totalDurationFormatted: formatAudioDuration(totalDurationSec),
    sourceType: "librivox",
    chapters,
  };
}

const AUDIOBOOK_PROGRESS_KEY_PREFIX = "aibook:audio_progress:";

export function getAudiobookProgress(audiobookId: string): AudiobookProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${AUDIOBOOK_PROGRESS_KEY_PREFIX}${audiobookId}`);
    return raw ? (JSON.parse(raw) as AudiobookProgress) : null;
  } catch {
    return null;
  }
}

export function saveAudiobookProgress(progress: AudiobookProgress): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      `${AUDIOBOOK_PROGRESS_KEY_PREFIX}${progress.audiobookId}`,
      JSON.stringify(progress)
    );
  } catch {
    // Ignore storage quota errors
  }
}
