// Turning a test's listening text into one recording, on the server, with the
// app's own Gemini key — the teacher agent sends words, never audio.
//
// Separate from app/api/tts/route.ts on purpose: that route speaks single
// vocabulary items in a calm teacher's voice and caches per word; a listening
// passage is a whole monologue or a two-voice conversation directed as a
// scene, and is cached as one file per test section.
//
// The model id is configurable (ASSESSMENT_TTS_MODEL) and defaults to the one
// the app already speaks with. Verified against the live API on 2026-10-02:
// gemini-3.8-flash-tts on the Interactions endpoint takes a dialogue in one
// request when each line names its speaker inside a speech_metadata
// annotation and generation_config.speech_config maps speakers to voices; it
// returns 24 kHz 16-bit mono PCM and does not read the speaker names aloud.

import { createHash } from "node:crypto";
import {
  GEMINI_TTS_FALLBACK_MODELS,
  GEMINI_TTS_MODEL,
  getGeminiTtsLanguageCode,
  getLanguageName,
  isVerbatimGeminiTtsModel,
} from "@/lib/ttsProviders";
import { parseWav } from "@/lib/wav";
import type { AudioSpec, DialogueSpec, Pace } from "./model";

const SAMPLE_RATE = 24000;
/** Silence between lines when a dialogue has to be stitched from single lines. */
const LINE_GAP_MS = 450;
/** Speakers one multi-speaker request is trusted with. More are stitched. */
const MULTI_SPEAKER_LIMIT = 2;

export function assessmentTtsModels(): string[] {
  const preferred = (process.env.ASSESSMENT_TTS_MODEL || "").trim() || GEMINI_TTS_MODEL;
  return [preferred, GEMINI_TTS_MODEL, ...GEMINI_TTS_FALLBACK_MODELS]
    .filter((m, i, all) => m && all.indexOf(m) === i);
}

/**
 * The cache identity of a recording: everything that changes the sound.
 * Same spec on the same model → the same file, whichever test asks for it.
 */
export function audioSpecHash(spec: AudioSpec, model: string): string {
  return createHash("sha256").update(JSON.stringify({ v: 1, model, spec })).digest("hex");
}

const PACE_DIRECTION: Record<Pace, string> = {
  slow: "Speak slowly and very clearly, as for a beginner learner, with short pauses between sentences.",
  normal: "Speak at a natural, moderate pace.",
  fast: "Speak at a brisk, natural native pace.",
};

export function buildListeningStyle(spec: AudioSpec): string {
  const language = getLanguageName(spec.language) ?? "the text's";
  const who = spec.kind === "dialogue"
    ? `A natural ${language} conversation between native ${language} speakers (${spec.speakers.map((s) => s.name).join(", ")}).`
    : `A native ${language} speaker.`;
  return [
    who,
    `Standard ${language} pronunciation.`,
    PACE_DIRECTION[spec.pace],
    spec.style,
    "Speak only the given lines; never read speaker names, labels or stage directions aloud; no laughter or sound effects.",
  ].filter(Boolean).join(" ");
}

type Pcm = { pcm: Buffer; sampleRate: number };

class SpeechError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function toPcm(base64: string): Pcm {
  const buf = Buffer.from(base64, "base64");
  if (buf.subarray(0, 4).toString("latin1") === "RIFF") {
    const wav = parseWav(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    return { pcm: Buffer.from(wav.pcm), sampleRate: wav.sampleRate };
  }
  return { pcm: buf, sampleRate: SAMPLE_RATE };
}

type InteractionsAnswer = { steps?: { content?: { type?: string; data?: string }[] }[] };
type GenerateAnswer = { candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[] };

async function interactions(
  apiKey: string,
  model: string,
  content: { text: string; speaker?: string }[],
  style: string,
  voices: { voice: string; speaker?: string }[],
): Promise<Pcm> {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      model,
      input: [{
        type: "user_input",
        content: content.map((c) => ({
          type: "text",
          text: c.text,
          annotations: [{ type: "speech_metadata", style, ...(c.speaker ? { speaker: c.speaker } : {}) }],
        })),
      }],
      response_format: { type: "audio", mime_type: "audio/l16", sample_rate: SAMPLE_RATE },
      generation_config: { speech_config: voices },
    }),
  });
  if (!response.ok) {
    throw new SpeechError(`${model}: ${response.status} ${(await response.text()).slice(0, 300)}`, response.status);
  }
  const data = await response.json() as InteractionsAnswer;
  const audio = data.steps?.flatMap((s) => s.content ?? []).find((p) => p.type === "audio")?.data;
  if (!audio) throw new SpeechError(`${model}: no audio in the answer`, 502);
  return toPcm(audio);
}

/** Models before 3.8 take their direction as prose in the prompt itself. */
async function generateContent(apiKey: string, model: string, text: string, style: string, voice: string, lang: string): Promise<Pcm> {
  const languageCode = getGeminiTtsLanguageCode(lang);
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${style}\nRead aloud exactly this text and nothing else:\n\n${text}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          ...(languageCode ? { languageCode } : {}),
          voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
        },
      },
    }),
  });
  if (!response.ok) {
    throw new SpeechError(`${model}: ${response.status} ${(await response.text()).slice(0, 300)}`, response.status);
  }
  const data = await response.json() as GenerateAnswer;
  const audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!audio) throw new SpeechError(`${model}: no audio in the answer`, 502);
  return toPcm(audio);
}

function speakOne(apiKey: string, model: string, text: string, voice: string, spec: AudioSpec): Promise<Pcm> {
  const style = buildListeningStyle(spec);
  return isVerbatimGeminiTtsModel(model)
    ? interactions(apiKey, model, [{ text }], style, [{ voice }])
    : generateContent(apiKey, model, text, style, voice, spec.language);
}

/** Lines one after another with a breath between them, at one sample rate. */
export function stitchPcm(parts: Pcm[], gapMs = LINE_GAP_MS): Pcm {
  const sampleRate = parts[0]?.sampleRate ?? SAMPLE_RATE;
  if (parts.some((p) => p.sampleRate !== sampleRate)) {
    throw new Error("Lines came back at different sample rates and cannot be joined.");
  }
  const silence = Buffer.alloc(Math.round((sampleRate * gapMs) / 1000) * 2);
  const chunks: Buffer[] = [];
  parts.forEach((p, i) => {
    if (i > 0) chunks.push(silence);
    chunks.push(p.pcm);
  });
  return { pcm: Buffer.concat(chunks), sampleRate };
}

async function speakDialogueByLines(apiKey: string, model: string, spec: DialogueSpec): Promise<Pcm> {
  const voiceOf = new Map(spec.speakers.map((s) => [s.name, s.voice]));
  const parts: Pcm[] = [];
  // In order and one at a time: each model allows ten requests a minute.
  for (const line of spec.lines) {
    parts.push(await speakOne(apiKey, model, line.text, voiceOf.get(line.speaker) ?? "Kore", spec));
  }
  return stitchPcm(parts);
}

async function speakWithModel(apiKey: string, model: string, spec: AudioSpec): Promise<Pcm> {
  if (spec.kind === "monologue") return speakOne(apiKey, model, spec.text, spec.voice, spec);

  if (isVerbatimGeminiTtsModel(model) && spec.speakers.length <= MULTI_SPEAKER_LIMIT) {
    try {
      return await interactions(
        apiKey,
        model,
        spec.lines.map((l) => ({ text: l.text, speaker: l.speaker })),
        buildListeningStyle(spec),
        spec.speakers.map((s) => ({ voice: s.voice, speaker: s.name })),
      );
    } catch (error) {
      // A quota refusal is the model's, not the format's: let the caller move
      // on to the next model rather than spend the same quota line by line.
      if (error instanceof SpeechError && error.status === 429) throw error;
      console.warn("Multi-speaker request failed, stitching line by line:", error);
    }
  }
  return speakDialogueByLines(apiKey, model, spec);
}

export type Synthesized = { wav: Buffer; durationMs: number; model: string };

/** Speak the spec with the first model that answers. Throws with every model's reason. */
export async function synthesizeListening(spec: AudioSpec): Promise<Synthesized> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set on the server.");
  const reasons: string[] = [];
  for (const model of assessmentTtsModels()) {
    try {
      const { pcm, sampleRate } = await speakWithModel(apiKey, model, spec);
      if (pcm.length < sampleRate) throw new Error(`${model}: recording is suspiciously short`);
      return { wav: pcmToWav(pcm, sampleRate), durationMs: Math.round((pcm.length / 2 / sampleRate) * 1000), model };
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`No speech model produced the recording: ${reasons.join(" | ")}`);
}

export function pcmToWav(pcm: Buffer, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
