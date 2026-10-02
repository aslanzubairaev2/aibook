// Azure Pronunciation Assessment for speaking tasks.
//
// What Azure actually returns for de-DE was checked against the live service on
// 2026-10-02 (resource on the F0 tier, region from AZURE_SPEECH_REGION):
//  - sentence: AccuracyScore, FluencyScore, CompletenessScore, PronScore;
//    no ProsodyScore for German, even when prosody assessment is requested;
//  - per word: AccuracyScore, ErrorType (None / Mispronunciation / Omission /
//    Insertion with miscue on), Offset and Duration in 100-ns ticks;
//  - phonemes and syllables come back with EMPTY names and a score that only
//    repeats the word's — so no sound names are reported, ever;
//  - an empty reference text works (unscripted): scores without completeness.
// Anything Azure does not return is null here, never zero, and nothing in this
// module turns a score into a CEFR level.
//
// The key never leaves the server: it is read from the environment per call
// and appears in no result, log line or client payload.

import { getGeminiTtsLanguageCode } from "@/lib/ttsProviders";

export type SpeechScores = {
  /** Azure's overall pronunciation score (PronScore), 0–100. */
  pronunciation: number | null;
  accuracy: number | null;
  fluency: number | null;
  /** Only meaningful against a reference text; null for free answers. */
  completeness: number | null;
  /** Not returned for German: always null today. */
  prosody: number | null;
};

export type SpeechWord = {
  word: string;
  accuracy: number | null;
  /** None | Mispronunciation | Omission | Insertion — exactly as Azure says. */
  error_type: string;
  offset_ms: number | null;
  duration_ms: number | null;
};

export type TechnicalReason =
  | "silence"
  | "unrecognized"
  | "noise"
  | "unsupported_format"
  | "too_long"
  | "too_short"
  | "service_unavailable"
  | "not_configured";

export const TECHNICAL_REASON_RU: Record<TechnicalReason, string> = {
  silence: "В записи тишина — проверьте микрофон и запишите ещё раз.",
  unrecognized: "Речь не распознана — говорите ближе к микрофону.",
  noise: "Слишком шумно — попробуйте в более тихом месте.",
  unsupported_format: "Не удалось прочитать запись.",
  too_long: "Запись длиннее разрешённого.",
  too_short: "Запись слишком короткая.",
  service_unavailable: "Сервис оценки временно недоступен — запись сохранена, попробуйте отправить её ещё раз.",
  not_configured: "Оценка произношения не настроена на сервере.",
};

export type SpeechAnalysis =
  | { status: "done"; transcript: string; scores: SpeechScores; words: SpeechWord[]; raw: unknown }
  | { status: "technical_error"; reason: TechnicalReason; detail: string; raw: unknown };

export function speechConfig(): { key: string; region: string } | null {
  const key = (process.env.AZURE_SPEECH_KEY || "").trim();
  const region = (process.env.AZURE_SPEECH_REGION || "").trim().toLowerCase();
  if (!key || !/^[a-z0-9]+$/.test(region)) return null;
  return { key, region };
}

export function azureLocale(lang: string): string {
  return getGeminiTtsLanguageCode(lang) ?? "de-DE";
}

/** Is the key accepted? Uses the token endpoint, which costs nothing. */
export async function checkSpeechService() {
  const config = speechConfig();
  const base = {
    provider: "Azure AI Speech — Pronunciation Assessment",
    configured: Boolean(config),
    region: config?.region ?? null,
    checked_at: new Date().toISOString(),
  };
  if (!config) {
    return { ...base, ok: false, error: "AZURE_SPEECH_KEY / AZURE_SPEECH_REGION are not set on the server." };
  }
  try {
    const response = await fetch(`https://${config.region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": config.key, "Content-Length": "0" },
    });
    if (response.ok) return { ...base, ok: true, error: null };
    return {
      ...base,
      ok: false,
      error: response.status === 401 || response.status === 403
        ? `The key was refused (HTTP ${response.status}) — wrong key or a key from another region.`
        : `Azure answered HTTP ${response.status}.`,
    };
  } catch {
    return { ...base, ok: false, error: "Azure could not be reached." };
  }
}

/** What was verified against the live service for German, for the teacher to read. */
export const GERMAN_CAPABILITIES = {
  locale: "de-DE",
  verified_on: "2026-10-02",
  sentence_scores: ["pronunciation (PronScore)", "accuracy", "fluency", "completeness (scripted only)"],
  word_level: ["accuracy", "error_type: Mispronunciation | Omission | Insertion", "offset_ms / duration_ms"],
  not_available: [
    "prosody score (null for German)",
    "phoneme or syllable names — Azure returns them empty for German, so sound-level errors are never reported",
  ],
  unscripted: "Supported (free answers): scores without completeness; the transcript is what was heard, not proof of correct pronunciation.",
  max_audio_seconds: 55,
  note: "Azure scores are pronunciation measurements 0–100, not CEFR levels.",
};

// ─── WAV ─────────────────────────────────────────────────────────────────────

export type WavInfo = { sampleRate: number; channels: number; bitsPerSample: number; durationMs: number };

/** The upload must be 16 kHz mono 16-bit PCM WAV — the format the client encodes and Azure reads. */
export function inspectWav(buf: Buffer): WavInfo | null {
  if (buf.length < 44 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") return null;
  let offset = 12;
  let fmt: Omit<WavInfo, "durationMs"> | null = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("latin1", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      fmt = { channels: buf.readUInt16LE(offset + 10), sampleRate: buf.readUInt32LE(offset + 12), bitsPerSample: buf.readUInt16LE(offset + 22) };
    } else if (id === "data" && fmt) {
      const bytes = Math.min(size, buf.length - offset - 8);
      const durationMs = Math.round((bytes / (fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8))) * 1000);
      return { ...fmt, durationMs };
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}

// ─── Assessment ──────────────────────────────────────────────────────────────

type AzureWord = {
  Word?: string;
  Offset?: number;
  Duration?: number;
  AccuracyScore?: number;
  ErrorType?: string;
  PronunciationAssessment?: { AccuracyScore?: number; ErrorType?: string };
};
type AzureBest = {
  Display?: string;
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  PronScore?: number;
  ProsodyScore?: number;
  PronunciationAssessment?: { AccuracyScore?: number; FluencyScore?: number; CompletenessScore?: number; PronScore?: number; ProsodyScore?: number };
  Words?: AzureWord[];
};
type AzureAnswer = { RecognitionStatus?: string; DisplayText?: string; NBest?: AzureBest[] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const ticksToMs = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v / 10000) : null);

/** Azure's detailed answer → what the app stores. Pure, so it is tested on recorded answers. */
export function normalizeAzureAnswer(raw: unknown, scripted: boolean): SpeechAnalysis {
  const answer = (raw ?? {}) as AzureAnswer;
  const status = answer.RecognitionStatus ?? "";
  if (status !== "Success") {
    const reason: TechnicalReason = status === "InitialSilenceTimeout"
      ? "silence"
      : status === "BabbleTimeout"
        ? "noise"
        : status === "NoMatch"
          ? "unrecognized"
          : "service_unavailable";
    return { status: "technical_error", reason, detail: status || "no status", raw };
  }
  const best = answer.NBest?.[0];
  const transcript = (best?.Display ?? answer.DisplayText ?? "").trim();
  if (!best || !/\p{L}/u.test(transcript)) return { status: "technical_error", reason: "silence", detail: "empty transcript", raw };
  // Verified live: silence against a reference text comes back as «Success»
  // with the transcript ".", zero scores and every word an Omission. That is
  // a silent recording, not a score of zero.
  const heard = (best.Words ?? []).filter((w) => (w.PronunciationAssessment?.ErrorType ?? w.ErrorType) !== "Omission");
  if ((best.Words?.length ?? 0) > 0 && heard.length === 0) {
    return { status: "technical_error", reason: "silence", detail: "every word omitted", raw };
  }

  const pa = best.PronunciationAssessment ?? {};
  const words = (best.Words ?? []).map((w) => ({
    word: String(w.Word ?? ""),
    accuracy: num(w.PronunciationAssessment?.AccuracyScore ?? w.AccuracyScore),
    error_type: String(w.PronunciationAssessment?.ErrorType ?? w.ErrorType ?? "None"),
    offset_ms: ticksToMs(w.Offset),
    duration_ms: ticksToMs(w.Duration),
  }));
  return {
    status: "done",
    transcript,
    scores: {
      pronunciation: num(pa.PronScore ?? best.PronScore),
      accuracy: num(pa.AccuracyScore ?? best.AccuracyScore),
      fluency: num(pa.FluencyScore ?? best.FluencyScore),
      completeness: scripted ? num(pa.CompletenessScore ?? best.CompletenessScore) : null,
      prosody: num(pa.ProsodyScore ?? best.ProsodyScore),
    },
    words,
    raw,
  };
}

/** One call to Azure's short-audio recognizer with pronunciation assessment. */
export async function assessPronunciation(wav: Buffer, lang: string, referenceText: string): Promise<SpeechAnalysis> {
  const config = speechConfig();
  if (!config) return { status: "technical_error", reason: "not_configured", detail: "missing env", raw: null };
  const scripted = referenceText.trim().length > 0;
  const settings = {
    ReferenceText: referenceText.trim(),
    GradingSystem: "HundredMark",
    Granularity: "Word",
    Dimension: "Comprehensive",
    EnableMiscue: scripted,
  };
  const locale = azureLocale(lang);
  try {
    const response = await fetch(
      `https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=detailed`,
      {
        method: "POST",
        headers: {
          "Ocp-Apim-Subscription-Key": config.key,
          "Content-Type": "audio/wav; codecs=audio/pcm; samplerate=16000",
          "Pronunciation-Assessment": Buffer.from(JSON.stringify(settings), "utf8").toString("base64"),
          Accept: "application/json",
        },
        body: new Uint8Array(wav),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      return {
        status: "technical_error",
        reason: response.status === 400 || response.status === 415 ? "unsupported_format" : "service_unavailable",
        detail: `HTTP ${response.status}`,
        raw: text.slice(0, 2000),
      };
    }
    return normalizeAzureAnswer(JSON.parse(text), scripted);
  } catch (error) {
    return { status: "technical_error", reason: "service_unavailable", detail: error instanceof Error ? error.message.slice(0, 200) : "fetch failed", raw: null };
  }
}

// ─── Plain-language feedback ─────────────────────────────────────────────────

/**
 * Remarks in Russian, built only from what Azure measured: which words were
 * heard as mispronounced, left out or added. No guessed sounds or causes.
 */
export function speechRemarks(words: SpeechWord[], scripted: boolean): string[] {
  const out: string[] = [];
  const weak = words.filter((w) => w.error_type === "Mispronunciation" || (w.error_type === "None" && w.accuracy !== null && w.accuracy < 60));
  const omitted = scripted ? words.filter((w) => w.error_type === "Omission") : [];
  const inserted = scripted ? words.filter((w) => w.error_type === "Insertion") : [];
  if (weak.length) out.push(`Неточно произнесено: ${weak.map((w) => `«${w.word}»${w.accuracy !== null ? ` (${w.accuracy})` : ""}`).join(", ")}.`);
  if (omitted.length) out.push(`Пропущено: ${omitted.map((w) => `«${w.word}»`).join(", ")}.`);
  if (inserted.length) out.push(`Лишнее (нет в тексте): ${inserted.map((w) => `«${w.word}»`).join(", ")}.`);
  if (!out.length) out.push("Все слова распознаны без замечаний.");
  return out;
}
