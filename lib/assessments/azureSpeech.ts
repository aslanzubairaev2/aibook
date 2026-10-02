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
import { alignReference, mergePhrases, phraseCutShort, sentences, sliceWav, splitOnPauses, SAMPLE_RATE, type PhraseResult } from "./speechSegments";

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
  | "incomplete_recognition"
  | "not_configured";

export const TECHNICAL_REASON_RU: Record<TechnicalReason, string> = {
  silence: "В записи тишина — проверьте микрофон и запишите ещё раз.",
  unrecognized: "Речь не распознана — говорите ближе к микрофону.",
  noise: "Слишком шумно — попробуйте в более тихом месте.",
  unsupported_format: "Не удалось прочитать запись.",
  too_long: "Запись длиннее разрешённого.",
  too_short: "Запись слишком короткая.",
  service_unavailable: "Сервис оценки временно недоступен — запись сохранена, попробуйте отправить её ещё раз.",
  incomplete_recognition: "Распознана не вся запись, поэтому оценка не выставлена. Это техническая проблема, а не ошибка ответа — попробуйте записать ещё раз.",
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

/**
 * Assess a whole recording.
 *
 * The short-audio endpoint hears one utterance and stops at the first long
 * pause, so a recording with several phrases is split at its pauses
 * (speechSegments.ts) and every phrase is assessed on its own — against its
 * own slice of the reading text when there is one — then merged back. If any
 * phrase still comes back cut short, the answer is a technical status: a gap
 * in recognition must never read as missing content.
 */
export async function assessPronunciation(wav: Buffer, lang: string, referenceText: string): Promise<SpeechAnalysis> {
  const pcm = pcmOf(wav);
  const segments = pcm ? splitOnPauses(pcm) : [];
  if (!pcm || segments.length <= 1) {
    const single = await assessSegment(wav, lang, referenceText);
    if (single.status === "done" && segments[0]) {
      if (phraseCutShort({ segment: { ...segments[0], startMs: 0 }, words: single.words })) {
        return { status: "technical_error", reason: "incomplete_recognition", detail: "speech continues after the last recognized word", raw: single.raw };
      }
    }
    return single;
  }

  const scripted = referenceText.trim().length > 0;
  const audio = segments.map((segment) => wavOf(sliceWav(pcm, segment)));
  // Three phrases at a time: quick, and inside the F0 tier's concurrency.
  async function eachPhrase(fn: (i: number) => Promise<SpeechAnalysis>): Promise<SpeechAnalysis[]> {
    const out: SpeechAnalysis[] = [];
    for (let i = 0; i < segments.length; i += 3) {
      const batch = await Promise.all(segments.slice(i, i + 3).map((_, j) => fn(i + j)));
      out.push(...batch);
    }
    return out;
  }

  let references: string[] = segments.map(() => "");
  if (scripted) {
    const bySentence = sentences(referenceText);
    if (bySentence.length === segments.length) {
      references = bySentence;
    } else {
      // Phrases and sentences do not line up: hear each phrase first, then
      // give it the stretch of the text it actually read.
      const heard = await eachPhrase((i) => assessSegment(audio[i], lang, ""));
      references = alignReference(referenceText, heard.map((h) => (h.status === "done" ? h.transcript : "")));
    }
  }

  const analyses = await eachPhrase((i) => assessSegment(audio[i], lang, references[i]));
  const phrases: PhraseResult[] = [];
  for (let i = 0; i < analyses.length; i++) {
    const a = analyses[i];
    if (a.status === "technical_error") {
      // A phrase that was only a breath or a cough is not part of the answer.
      if (a.reason === "silence" || a.reason === "unrecognized" || a.reason === "noise") continue;
      return a;
    }
    const phrase: PhraseResult = {
      segment: segments[i],
      transcript: a.transcript,
      scores: a.scores,
      words: a.words,
      referenceWords: references[i].split(" ").filter(Boolean).length,
    };
    if (phraseCutShort(phrase)) {
      return { status: "technical_error", reason: "incomplete_recognition", detail: `phrase ${i + 1} of ${segments.length} cut short`, raw: analyses.map((x) => x.raw) };
    }
    phrases.push(phrase);
  }
  if (phrases.length === 0) {
    return { status: "technical_error", reason: "silence", detail: "no phrase recognized", raw: analyses.map((x) => x.raw) };
  }
  const merged = mergePhrases(phrases, scripted);
  return {
    status: "done",
    ...merged,
    raw: {
      phrases: phrases.length,
      segments: segments.map((s, i) => ({ ...s, reference: references[i] || null, answer: analyses[i].raw })),
    },
  };
}

function pcmOf(wav: Buffer): Int16Array | null {
  const info = inspectWav(wav);
  if (!info || info.sampleRate !== SAMPLE_RATE || info.channels !== 1 || info.bitsPerSample !== 16) return null;
  const dataStart = wav.indexOf("data", 12, "latin1") + 8;
  if (dataStart < 8) return null;
  const length = Math.floor((wav.length - dataStart) / 2);
  const copy = Buffer.from(wav.subarray(dataStart, dataStart + length * 2));
  return new Int16Array(copy.buffer, copy.byteOffset, length);
}

function wavOf(pcm: Int16Array): Buffer {
  const body = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + body.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(body.length, 40);
  return Buffer.concat([header, body]);
}

/** One call to Azure's short-audio recognizer with pronunciation assessment: one utterance. */
async function assessSegment(wav: Buffer, lang: string, referenceText: string): Promise<SpeechAnalysis> {
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
