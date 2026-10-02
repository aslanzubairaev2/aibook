// Long answers, assessed whole.
//
// Azure's short-audio REST endpoint recognizes ONE utterance: it stops at the
// first long pause and silently drops the rest. Found on a real answer
// (attempt ba22a898, item s3): three sentences with pauses, 24.4 s recorded and
// sent in full, but only the first sentence came back (it ended at 6.5 s).
//
// So the server finds the pauses itself, sends every phrase on its own, and
// puts the results back together: one transcript, word timings shifted to
// their place in the recording, and scores weighted by how much each phrase
// carried. Pure functions here; the network part is in azureSpeech.ts.

import { LOW_CONFIDENCE, type Delivery, type PhraseInfo, type SpeechScores, type SpeechWord } from "./azureSpeech";

export const SAMPLE_RATE = 16000;
const FRAME_MS = 20;
/** A pause this long starts a new phrase — longer than any pause inside a sentence. */
export const PHRASE_PAUSE_MS = 1100;
/** Silence kept on both sides of a phrase so its first and last sounds are not clipped. */
const PAD_MS = 250;
/** No phrase longer than this goes to the endpoint (its limit is 60 s). */
const MAX_PHRASE_MS = 50000;

export type Segment = { startMs: number; endMs: number; voicedStartMs: number; voicedEndMs: number };

function frameEnergies(pcm: Int16Array): number[] {
  const size = (SAMPLE_RATE * FRAME_MS) / 1000;
  const out: number[] = [];
  for (let i = 0; i < pcm.length; i += size) {
    let sum = 0;
    const end = Math.min(i + size, pcm.length);
    for (let j = i; j < end; j++) sum += pcm[j] * pcm[j];
    out.push(Math.sqrt(sum / Math.max(1, end - i)));
  }
  return out;
}

/**
 * Voiced frames, by a threshold relative to this recording: above its noise
 * floor and a share of its loudest speech, so a quiet microphone and a loud
 * room both work.
 */
export function voicedFrames(pcm: Int16Array): boolean[] {
  const energy = frameEnergies(pcm);
  if (energy.length === 0) return [];
  const sorted = [...energy].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const peak = sorted[Math.floor(sorted.length * 0.98)] ?? 0;
  const threshold = Math.max(120, floor * 2.5, peak * 0.06);
  return energy.map((e) => e > threshold);
}

/** Phrases separated by pauses of PHRASE_PAUSE_MS or more. */
export function splitOnPauses(pcm: Int16Array): Segment[] {
  const voiced = voicedFrames(pcm);
  const totalMs = Math.round((pcm.length / SAMPLE_RATE) * 1000);
  const runs: { start: number; end: number }[] = [];
  let start = -1;
  let lastVoiced = -1;
  voiced.forEach((v, i) => {
    if (!v) return;
    if (start < 0) start = i;
    else if ((i - lastVoiced - 1) * FRAME_MS >= PHRASE_PAUSE_MS) {
      runs.push({ start, end: lastVoiced + 1 });
      start = i;
    }
    lastVoiced = i;
  });
  if (start >= 0) runs.push({ start, end: lastVoiced + 1 });

  // Clicks and breaths are not phrases.
  const phrases = runs.filter((r) => (r.end - r.start) * FRAME_MS >= 200);
  const segments: Segment[] = [];
  for (const r of phrases) {
    const voicedStartMs = r.start * FRAME_MS;
    // A phrase is never merged with the next one: a pause this long is exactly
    // where the endpoint would stop listening.
    const voicedEndMs = Math.min(totalMs, r.end * FRAME_MS, voicedStartMs + MAX_PHRASE_MS);
    segments.push({
      startMs: Math.max(0, voicedStartMs - PAD_MS),
      endMs: Math.min(totalMs, voicedEndMs + PAD_MS),
      voicedStartMs,
      voicedEndMs,
    });
  }
  return segments;
}

/** Bare tokens for aligning what was said with the text to read. */
export function tokens(text: string): string[] {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Split a reading text into sentences, keeping their punctuation. */
export function sentences(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Which slice of the reference each phrase read, from what was heard in it.
 *
 * A greedy alignment: each phrase claims the stretch of reference words that
 * best matches its heard words, starting where the previous phrase stopped.
 * Good enough to give every phrase its own reference — the scoring of each
 * word is still Azure's.
 */
export function alignReference(reference: string, heard: string[]): string[] {
  const refWords = reference.split(/\s+/).filter(Boolean);
  const refTokens = refWords.map((w) => tokens(w).join(" "));
  const slices: string[] = [];
  let cursor = 0;
  heard.forEach((transcript, index) => {
    const said = tokens(transcript);
    if (index === heard.length - 1) {
      slices.push(refWords.slice(cursor).join(" "));
      cursor = refWords.length;
      return;
    }
    // Try every end point and keep the one where the slice and the heard
    // words share the most tokens, preferring the length closest to what was said.
    let bestEnd = Math.min(refWords.length, cursor + Math.max(1, said.length));
    let bestScore = -Infinity;
    const remainingPhrases = heard.length - index - 1;
    for (let end = cursor + 1; end <= refWords.length - remainingPhrases; end++) {
      const slice = refTokens.slice(cursor, end);
      const shared = slice.filter((t) => said.includes(t)).length;
      const score = shared * 2 - Math.abs(slice.length - said.length) * 0.5;
      if (score > bestScore) { bestScore = score; bestEnd = end; }
    }
    slices.push(refWords.slice(cursor, bestEnd).join(" "));
    cursor = bestEnd;
  });
  return slices;
}

export type PhraseResult = {
  segment: Segment;
  transcript: string;
  scores: SpeechScores;
  words: SpeechWord[];
  /** Reference words this phrase was assessed against (scripted only). */
  referenceWords: number;
  /** Azure's recognition confidence for the phrase, 0–1. */
  confidence?: number | null;
};

function weighted(parts: { value: number | null; weight: number }[]): number | null {
  const usable = parts.filter((p) => p.value !== null && p.weight > 0);
  const total = usable.reduce((n, p) => n + p.weight, 0);
  if (total === 0) return null;
  return Math.round((usable.reduce((n, p) => n + (p.value as number) * p.weight, 0) / total) * 10) / 10;
}

/**
 * Phrases back into one answer. Words move to their place in the whole
 * recording; accuracy and the overall score are weighted by the words a phrase
 * contained, fluency by how long it was spoken, completeness by the reference
 * words it covered. Prosody stays null when no phrase had it.
 */
export function mergePhrases(phrases: PhraseResult[], scripted: boolean): { transcript: string; scores: SpeechScores; words: SpeechWord[]; phrases: PhraseInfo[]; delivery: Delivery } {
  const words = phrases.flatMap((p) => p.words.map((w) => ({
    ...w,
    // An omitted word was never said, so it has no place in the recording.
    offset_ms: w.error_type === "Omission" || w.offset_ms === null ? null : w.offset_ms + p.segment.startMs,
  })));
  const spoken = (p: PhraseResult) => p.words.filter((w) => w.error_type !== "Omission").length;
  const length = (p: PhraseResult) => p.segment.voicedEndMs - p.segment.voicedStartMs;
  const pauses = phrases.slice(1).map((p, i) => Math.max(0, p.segment.voicedStartMs - phrases[i].segment.voicedEndMs));
  const speechMs = phrases.reduce((n, p) => n + length(p), 0);
  const pauseMs = pauses.reduce((n, x) => n + x, 0);
  return {
    transcript: phrases.map((p) => p.transcript).filter(Boolean).join(" "),
    words,
    phrases: phrases.map((p) => ({
      text: p.transcript,
      from_ms: p.segment.voicedStartMs,
      to_ms: p.segment.voicedEndMs,
      confidence: p.confidence ?? null,
      low_confidence: typeof p.confidence === "number" && p.confidence < LOW_CONFIDENCE,
    })),
    delivery: {
      phrases: phrases.length,
      speech_ms: speechMs,
      pause_ms: pauseMs,
      longest_pause_ms: pauses.length ? Math.max(...pauses) : 0,
      pauses_over_2s: pauses.filter((x) => x >= 2000).length,
      speech_ratio: speechMs + pauseMs > 0 ? Math.round((speechMs / (speechMs + pauseMs)) * 100) / 100 : null,
      fluency_within_phrases: weighted(phrases.map((p) => ({ value: p.scores.fluency, weight: length(p) }))),
    },
    scores: {
      pronunciation: weighted(phrases.map((p) => ({ value: p.scores.pronunciation, weight: Math.max(1, spoken(p)) }))),
      accuracy: weighted(phrases.map((p) => ({ value: p.scores.accuracy, weight: Math.max(1, spoken(p)) }))),
      // Azure measures fluency inside one phrase; the pauses between phrases
      // never reach it. A merged number would read as «fluent» an answer full
      // of long silences, so the whole answer gets none — see delivery.
      fluency: phrases.length > 1 ? null : phrases[0]?.scores.fluency ?? null,
      completeness: scripted ? weighted(phrases.map((p) => ({ value: p.scores.completeness, weight: p.referenceWords }))) : null,
      prosody: weighted(phrases.map((p) => ({ value: p.scores.prosody, weight: Math.max(1, spoken(p)) }))),
    },
  };
}

/**
 * Was the whole phrase heard? Speech running on more than a second and a half
 * past the last recognized word means the recognizer stopped early — that is
 * a technical gap, not missing content.
 */
export function phraseCutShort(phrase: Pick<PhraseResult, "segment" | "words">): boolean {
  const heard = phrase.words.filter((w) => w.error_type !== "Omission" && w.offset_ms !== null && w.duration_ms !== null);
  if (heard.length === 0) return false;
  const last = heard.at(-1)!;
  const lastEnd = phrase.segment.startMs + (last.offset_ms as number) + (last.duration_ms as number);
  return phrase.segment.voicedEndMs - lastEnd > 1500;
}

export function sliceWav(pcm: Int16Array, segment: Segment): Int16Array {
  const from = Math.floor((segment.startMs / 1000) * SAMPLE_RATE);
  const to = Math.min(pcm.length, Math.ceil((segment.endMs / 1000) * SAMPLE_RATE));
  return pcm.subarray(from, to);
}
