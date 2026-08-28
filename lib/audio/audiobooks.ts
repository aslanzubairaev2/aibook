import type { Audiobook, AudiobookChapter, AudiobookProgress, CefrConfidence, CefrLevel } from "@/lib/types";

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

// ─── CEFR classification ────────────────────────────────────────────────────
//
// Internet Archive / LibriVox metadata never carries a real CEFR rating — it is
// public-domain original text, not a graded reader. The previous heuristic
// treated genre and author keywords ("märchen", "grimm", "kinder", "easy") as
// proof of A1, which is wrong on its face: an unadapted 19th-century fairy
// tale collection is not beginner-friendly just because children are its
// audience. That produced confident-looking "A1" badges on books a true
// beginner could not read, which is the bug this module now refuses to repeat.
//
// The rule going forward: A1/A2 are only ever `verified` — recovered from an
// explicit marker the source itself states ("Niveau A1", "(B1)", "Graded
// Reader A2", "Leichtes Deutsch"). Everything else is either an `approximate`
// guess for B1..C2 (kept low-stakes: genre/author correlate weakly but
// plausibly with those harder levels) or `unverified` with no level at all —
// never a guessed A1/A2, since that is exactly the false-beginner-friendly
// claim this fix removes.

export type CefrClassification = {
  level: CefrLevel | null;
  confidence: CefrConfidence;
  /** One line, in Russian, explaining where the level came from. */
  explanation: string;
};

const CEFR_CODE = /(A1|A2|B1|B2|C1|C2)/i;

// "Niveau A1", "Level: B2", "Stufe B1", "CEFR A2" — a labelled level, the
// strongest possible signal.
const LABELLED_MARKER = new RegExp(`\\b(?:niveau|level|stufe|cefr)\\b\\s*[:\\-]?\\s*${CEFR_CODE.source}\\b`, "i");
// "(A1)", "[B2]" — bracketed codes are how graded readers usually print them.
const BRACKETED_MARKER = new RegExp(`[(\\[]\\s*${CEFR_CODE.source}\\s*[)\\]]`, "i");
// "Der Prozess – B2", "Title: A2" — a code set off by a dash or colon at a
// word boundary, distinct from a code buried mid-word (avoids "iPad2"-style
// false positives).
const DASH_MARKER = new RegExp(`[\\-–—:]\\s*${CEFR_CODE.source}\\b(?!\\w)`);
const GRADED_READER_MARKER = /\bgraded reader\b/i;
const EASY_GERMAN_MARKER = /\bleichtes deutsch\b|\beasy german\b/i;

/** Recovers an explicit, source-stated CEFR code from free text, if one exists. */
export function detectExplicitCefr(text: string): { level: CefrLevel; matchedText: string } | null {
  const match =
    text.match(LABELLED_MARKER) ?? text.match(BRACKETED_MARKER) ?? text.match(DASH_MARKER);
  if (match) {
    return { level: match[1].toUpperCase() as CefrLevel, matchedText: match[0].trim() };
  }
  // "Graded Reader" alone doesn't carry a number, but one is often printed
  // elsewhere in the same title/description — still an explicit claim, not a
  // guess, once both pieces are present.
  if (GRADED_READER_MARKER.test(text)) {
    const loose = text.match(CEFR_CODE);
    if (loose) return { level: loose[1].toUpperCase() as CefrLevel, matchedText: `Graded Reader ${loose[0]}` };
  }
  return null;
}

/**
 * Author surnames need a standalone match, not a substring one: German forms
 * agentive/family surnames by compounding ("-mann" = "man"), so plain
 * `.includes()` turned "Hoffmann" into a Thomas-Mann hit and "Hessen" (the
 * state) into a Hermann-Hesse hit. Genre/subject words are deliberately left
 * as substrings, since German compounds them freely and usefully the other
 * way — "Schachnovelle" should still surface "novelle".
 */
function matchesStandalone(haystack: string, keyword: string): boolean {
  const isLetter = (ch: string | undefined) => !!ch && /[a-zäöüß]/i.test(ch);
  let index = haystack.indexOf(keyword);
  while (index !== -1) {
    if (!isLetter(haystack[index - 1]) && !isLetter(haystack[index + keyword.length])) return true;
    index = haystack.indexOf(keyword, index + 1);
  }
  return false;
}

/** Genre/author correlate loosely with difficulty for B1..C2 — never for A1/A2, see module note. */
const APPROXIMATE_AUTHORS: Record<"B1" | "B2" | "C1" | "C2", string[]> = {
  B1: ["zweig", "kafka", "doyle", "verne", "stifter", "storm"],
  B2: ["fontane", "mann", "hesse", "heine", "chekhov", "tolstoy"],
  C1: ["goethe", "schiller", "nietzsche", "kant", "schopenhauer"],
  C2: ["faust", "zarathustra"],
};
const APPROXIMATE_SUBJECTS: Record<"B1" | "B2" | "C1" | "C2", string[]> = {
  B1: ["novelle", "erzählung", "abenteuer", "mystery", "detective"],
  // "novel" deliberately omitted: as a plain substring it matches inside the
  // German "novelle" (B1) — e.g. "Schachnovelle" was misclassified B2 because
  // B2 is checked first. "roman"/"fiction" already cover the same signal.
  B2: ["roman", "fiction", "drama", "biography"],
  C1: ["philosophie", "philosophy", "gedichte", "poetry", "tragödie"],
  C2: ["kritik der reinen vernunft", "metaphysik", "mittelhochdeutsch", "altdeutsch", "theologie", "epos"],
};

function findApproximateMatch(lower: string, level: "B1" | "B2" | "C1" | "C2"): string | null {
  const author = APPROXIMATE_AUTHORS[level].find((kw) => matchesStandalone(lower, kw));
  if (author) return author;
  return APPROXIMATE_SUBJECTS[level].find((kw) => lower.includes(kw)) ?? null;
}

/** True for text that skews clearly advanced (C1/C2 author or subject) — used to keep beginners off it. */
export function isLikelyAdvancedText(...parts: (string | undefined | null)[]): boolean {
  const combined = parts.filter(Boolean).join(" ").toLowerCase();
  return findApproximateMatch(combined, "C1") !== null || findApproximateMatch(combined, "C2") !== null;
}

/**
 * Classifies an audiobook's CEFR level honestly: a verified code beats any
 * heuristic, A1/A2 are never guessed, and "no signal" is reported as such
 * instead of defaulting to a level that looks precise but isn't.
 */
export function classifyAudiobookCefr(
  title: string,
  description?: string,
  subject?: string | string[]
): CefrClassification {
  const combined = [title || "", description || "", Array.isArray(subject) ? subject.join(" ") : subject || ""].join(" ");

  const explicit = detectExplicitCefr(combined);
  if (explicit) {
    return {
      level: explicit.level,
      confidence: "verified",
      explanation: `Уровень указан явно в источнике («${explicit.matchedText}»).`,
    };
  }

  if (EASY_GERMAN_MARKER.test(combined)) {
    return {
      level: "A2",
      confidence: "approximate",
      explanation: "Помечено как «Leichtes Deutsch» (упрощённый язык), но точный код CEFR не указан.",
    };
  }

  const lower = combined.toLowerCase();
  for (const level of ["C2", "C1", "B2", "B1"] as const) {
    const hit = findApproximateMatch(lower, level);
    if (hit) {
      return {
        level,
        confidence: "approximate",
        explanation: `Похоже на уровень ${level} по жанру/автору («${hit}»), но это не подтверждённая маркировка.`,
      };
    }
  }

  return {
    level: null,
    confidence: "unverified",
    explanation: "Оригинальный текст без адаптации — уровень CEFR не подтверждён источником.",
  };
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
  /**
   * Set only when a specific CEFR level was requested: how many of this
   * page's results actually classify at that level, after the honest-label
   * filter (see fetchAudiobooks). `total`/`totalPages` still describe the
   * underlying keyword search and cannot be read as "N books at this level".
   */
  matchedOnPage?: number;
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

  // The CEFR query above (subject:fairy-tale/adventure/classic) is a loose
  // keyword net over Internet Archive's metadata, not a real level filter —
  // it routinely pulls in books this classifier honestly rates at a
  // different level (a fairy-tale search returning an unadapted original is
  // "≈ B1", not A1). Selecting "A1" must not then display that "≈ B1" book
  // under an A1 heading, so a level-filtered request over-fetches a larger
  // raw batch and keeps only the rows that actually classify at the
  // requested level — a single request, just a bigger one, rather than an
  // extra round trip per page.
  const isLevelFiltered = Boolean(cefrLevel && cefrLevel !== "all");
  const rawRows = isLevelFiltered ? Math.min(pageSize * 6, 120) : pageSize;

  const urlParams = new URLSearchParams({
    q: finalQuery,
    "fl[]": "identifier,title,creator,description,language,publicdate,downloads,item_size,subject",
    "sort[]": "downloads desc",
    rows: String(rawRows),
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

    // Classified independently of the requested filter: the A1/A2 search query
    // above is a best-effort keyword match (fairy tales, short stories, ...),
    // not proof the result is actually beginner-level. Forcing every hit to
    // wear the filter's label was the exact bug this fix removes — a book
    // this classifier can't verify keeps an honest "unverified" badge even
    // when it matched an A1 search.
    const classification = classifyAudiobookCefr(title, description, subject);

    return {
      id: identifier,
      title,
      author,
      language: docLang,
      cefrLevel: classification.level,
      cefrConfidence: classification.confidence,
      cefrExplanation: classification.explanation,
      coverUrl: identifier ? `https://archive.org/services/img/${identifier}` : null,
      description,
      totalDurationSeconds: estSeconds,
      totalDurationFormatted: formatAudioDuration(estSeconds),
      downloads,
      sourceType: "librivox",
    };
  });

  if (!isLevelFiltered) {
    return {
      audiobooks,
      total: numFound,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(numFound / pageSize)),
    };
  }

  // Keep only what actually classifies at the requested level — this is the
  // step that stops "A1" from displaying a book this classifier rates "≈ B1".
  const matched = audiobooks.filter((b) => b.cefrLevel === cefrLevel).slice(0, pageSize);

  return {
    audiobooks: matched,
    // `numFound` counts the loose keyword search, not confirmed matches, so
    // it cannot be shown as "N audiobooks at this level" — see
    // matchedOnPage below for the number the UI can honestly display.
    total: numFound,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(numFound / pageSize)),
    matchedOnPage: matched.length,
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
  const classification = classifyAudiobookCefr(title, description, meta.subject);

  return {
    id: identifier,
    title,
    author,
    language,
    cefrLevel: classification.level,
    cefrConfidence: classification.confidence,
    cefrExplanation: classification.explanation,
    coverUrl: `https://archive.org/services/img/${identifier}`,
    description,
    totalDurationSeconds: totalDurationSec,
    totalDurationFormatted: formatAudioDuration(totalDurationSec),
    sourceType: "librivox",
    chapters,
  };
}

const AUDIOBOOK_PROGRESS_KEY_PREFIX = "aibook:audio_progress:";
const LAST_PLAYED_AUDIOBOOK_KEY = "aibook:audio_last_played";

export function getAudiobookProgress(audiobookId: string): AudiobookProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(`${AUDIOBOOK_PROGRESS_KEY_PREFIX}${audiobookId}`);
    return raw ? (JSON.parse(raw) as AudiobookProgress) : null;
  } catch {
    return null;
  }
}

/** The most recently played audiobook, with enough of a display snapshot for the home screen's "Продолжить слушать" tile. */
export function getLastPlayedAudiobook(): AudiobookProgress | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(LAST_PLAYED_AUDIOBOOK_KEY);
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
    // Same payload doubles as the "last played" pointer — one write, no
    // separate plumbing for the home screen to keep in sync.
    localStorage.setItem(LAST_PLAYED_AUDIOBOOK_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Picks the strongest level match for the home screen's "Лучше всего подходит
 * вашему уровню" tile. Prefers a verified match; falls back to an approximate
 * one (still labelled as such by the caller) rather than a level that can't
 * be backed up at all. Never returns a book whose level isn't the one asked
 * for, even approximately — see the module note on classifyAudiobookCefr.
 */
export function pickBestFitAudiobook(audiobooks: Audiobook[], level: CefrLevel): Audiobook | null {
  const matches = audiobooks.filter((b) => b.cefrLevel === level);
  const verified = matches.find((b) => b.cefrConfidence === "verified");
  if (verified) return verified;
  const approximate = matches
    .filter((b) => b.cefrConfidence === "approximate")
    .sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  return approximate[0] ?? null;
}
