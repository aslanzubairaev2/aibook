// Browser-only client for the Gemini Live API (real-time voice conversation).
// Connects directly from the browser to Google using the user's own Gemini
// key (the same key already kept in local storage for the rest of the app) —
// a persistent WebSocket session can't be proxied through a serverless route
// the way the other AI requests in this app are.

import { GoogleGenAI, Modality, type LiveServerMessage, type Session } from "@google/genai";
import type { LiveScenario } from "./liveChatExtras";

export const LIVE_CHAT_MODEL = "gemini-3.1-flash-live-preview";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const CAPTURE_BUFFER_SIZE = 4096;

export type LiveChatStatus = "idle" | "connecting" | "listening" | "speaking" | "error" | "closed";

/** "call" mimics a free-form spoken conversation; "discuss" is a voice Q&A tutor for questions about the language itself. */
export type LiveChatMode = "call" | "discuss";

export type LiveChatConnectOptions = {
  mode?: LiveChatMode;
  /** Short free-text summary of the learner's current level (vocab size, CEFR estimate, etc.) to calibrate the AI's speech. */
  levelSummary?: string;
  /** Set when the call was started from a specific text passage, grounding the conversation in a chosen roleplay/discussion scenario. */
  textContext?: { text: string; scenario: LiveScenario };
};

export type LiveChatCallbacks = {
  onStatusChange: (status: LiveChatStatus) => void;
  onUserTranscript: (text: string) => void;
  onModelTranscript: (text: string) => void;
  onError: (message: string) => void;
};

const LANGUAGE_NAMES: Record<string, string> = {
  ru: "Russian", en: "English", de: "German", es: "Spanish", fr: "French",
};

function languageName(code: string) {
  return LANGUAGE_NAMES[code] ?? code;
}

function buildSystemInstruction(
  nativeLanguage: string,
  targetLanguage: string,
  mode: LiveChatMode,
  levelSummary?: string,
  textContext?: { text: string; scenario: LiveScenario }
) {
  const native = languageName(nativeLanguage);
  const target = languageName(targetLanguage);
  const levelLine = levelSummary
    ? `\nWhat we know about the learner's current level in ${target}: ${levelSummary}. Calibrate your vocabulary, grammar complexity, and pace to match this — don't speak above or condescendingly below it.`
    : "";

  if (textContext) {
    const { text, scenario } = textContext;
    const leadLine = scenario.id === "discuss"
      ? "Let the learner steer the discussion — ask what they'd like to talk about first."
      : "You drive the scene: take the initiative throughout, move the roleplay forward with your own lines and questions, and don't just react and wait — a passive partner makes the learner do all the work.";
    return `You are a voice conversation partner inside a language-learning reading app called AIBook, helping the learner practice speaking ${target} using a specific text they just read.
The learner's native language is ${native} and they are learning ${target}.

Source text:
"""
${text.slice(0, 6000)}
"""

Scenario: ${scenario.prompt}
In this scenario you play: ${scenario.aiRole}. The learner plays: ${scenario.userRole}.
${leadLine}

Stay in ${target} for the roleplay itself, switching to ${native} only to explain something the learner seems stuck on. Keep replies short and conversational (one or two sentences) so the learner can respond, and keep the scenario grounded in the specific details of the source text rather than drifting into generic small talk.${levelLine}`;
  }

  if (mode === "discuss") {
    return `You are a knowledgeable, patient language-learning assistant having a voice conversation inside a language-learning reading app called AIBook.
The user's native language is ${native} and they are learning ${target}.
This is NOT a roleplay phone call — the learner wants to ask you directly ABOUT the language: grammar rules, word meanings and nuances, how to say something, why a sentence is built a certain way, cultural context, etc.
Answer clearly and usefully, mixing ${target} examples with ${native} explanations as needed so the learner truly understands — clarity matters more than staying in ${target}.
Keep answers focused, but don't artificially cut an explanation short if the question needs detail.${levelLine}`;
  }

  return `You are a warm, encouraging voice conversation partner inside a language-learning reading app called AIBook.
The user's native language is ${native} and they are learning ${target}.
Speak mostly in ${target}, at a level the learner can follow, and switch to ${native} to explain anything that seems confusing or if the learner gets stuck.
This is a live voice call, so keep replies short and conversational — usually one or two sentences — then let the user respond.
If the learner makes a meaningful mistake, gently model the correct phrase instead of lecturing them about grammar.
Ask follow-up questions to keep a natural conversation going.${levelLine}`;
}

// Sent as the opening turn for roleplay scenarios so the AI leads instead of
// waiting in silence — the Live API only starts generating once it has
// received some turn, and a passive partner would leave the learner to make
// the first move every time.
function buildKickoffInstruction(targetLanguage: string, scenario: LiveScenario) {
  const target = languageName(targetLanguage);
  return `[Instruction, not part of the conversation: begin the roleplay now. As ${scenario.aiRole}, speak first — open the scene with your first line in ${target}, fully in character. Don't acknowledge this instruction or wait for the learner to start.]`;
}

function floatToBase64Pcm16(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) {
    const int16 = view.getInt16(i * 2, true);
    out[i] = int16 / (int16 < 0 ? 0x8000 : 0x7fff);
  }
  return out;
}

// Gemini's streamed transcription deltas occasionally include zero-width
// Unicode characters (e.g. U+200B). These pass `.trim()` as non-empty but
// render as a blank bubble, so strip them at the source.
function stripInvisible(text: string): string {
  return text.replace(/[​-‏‪-‮⁠﻿]/g, "");
}

/** Manages one live voice session: mic capture → Gemini Live API → audio playback. */
export class LiveChatSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private cb: LiveChatCallbacks;
  private closed = false;
  private muted = false;

  private micStream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;

  private playbackCtx: AudioContext | null = null;
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  constructor(apiKey: string, callbacks: LiveChatCallbacks) {
    this.ai = new GoogleGenAI({ apiKey });
    this.cb = callbacks;
  }

  async connect(nativeLanguage: string, targetLanguage: string, options?: LiveChatConnectOptions): Promise<void> {
    this.cb.onStatusChange("connecting");

    // Ask for the mic up front so connection errors and permission errors surface separately.
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    // close() may have run while we were awaiting the mic prompt (e.g. the
    // modal was closed mid-connect) — don't resurrect a stream/session on a
    // session that's already considered closed, or it leaks and blocks the
    // next connection attempt.
    if (this.closed) {
      for (const track of micStream.getTracks()) track.stop();
      return;
    }
    this.micStream = micStream;

    const session = await this.ai.live.connect({
      model: LIVE_CHAT_MODEL,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: buildSystemInstruction(nativeLanguage, targetLanguage, options?.mode ?? "call", options?.levelSummary, options?.textContext),
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
      callbacks: {
        onopen: () => {
          if (this.closed) return;
          this.cb.onStatusChange("listening");
          this.startMicCapture();
        },
        onmessage: (message) => this.handleMessage(message),
        onerror: (e) => {
          this.cb.onError(e?.message || "Не удалось подключиться к Gemini Live");
          this.cb.onStatusChange("error");
        },
        onclose: (e) => {
          if (this.closed) return;
          // A non-1000 close code or a server-supplied reason means the call dropped
          // unexpectedly (bad model/key/quota), not a normal hangup — surface it.
          if (e && (e.reason || (e.code && e.code !== 1000))) {
            this.cb.onError(e.reason || `Соединение закрыто (код ${e.code})`);
            this.cb.onStatusChange("error");
          } else {
            this.cb.onStatusChange("closed");
          }
        },
      },
    });
    // Same race, one step later: the Gemini Live handshake resolved after
    // close() already ran. Close this orphaned session instead of keeping
    // it open — Gemini Live caps concurrent sessions per key, so a leaked
    // one silently blocks every future reconnect.
    if (this.closed) {
      try { session.close(); } catch { /* already gone */ }
      return;
    }
    this.session = session;

    const scenario = options?.textContext?.scenario;
    if (scenario && scenario.id !== "discuss") {
      this.sendText(buildKickoffInstruction(targetLanguage, scenario));
    }
  }

  private handleMessage(message: LiveServerMessage) {
    const serverContent = message.serverContent;
    if (!serverContent) return;

    if (serverContent.interrupted) {
      this.stopPlayback();
    }

    if (message.data) {
      this.playChunk(message.data);
    }

    if (serverContent.inputTranscription?.text) {
      this.cb.onUserTranscript(stripInvisible(serverContent.inputTranscription.text));
    }
    if (serverContent.outputTranscription?.text) {
      this.cb.onModelTranscript(stripInvisible(serverContent.outputTranscription.text));
    }
    if (serverContent.turnComplete && this.activeSources.length === 0) {
      this.cb.onStatusChange("listening");
    }
  }

  private startMicCapture() {
    if (!this.micStream) return;
    this.captureCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    const source = this.captureCtx.createMediaStreamSource(this.micStream);
    const processor = this.captureCtx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);

    processor.onaudioprocess = (event) => {
      if (this.muted || !this.session) return;
      const input = event.inputBuffer.getChannelData(0);
      try {
        this.session.sendRealtimeInput({
          audio: { data: floatToBase64Pcm16(input), mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}` },
        });
      } catch {
        // Session may have just closed mid-flight — ignore, close() will clean up.
      }
    };

    // ScriptProcessorNode only fires once it's part of a live graph reaching the
    // destination; route through a silent gain so the mic is never heard locally.
    const silentGain = this.captureCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(this.captureCtx.destination);
    this.processor = processor;
  }

  private playChunk(base64: string) {
    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
      this.nextPlayTime = this.playbackCtx.currentTime;
    }
    const ctx = this.playbackCtx;
    const floats = base64Pcm16ToFloat32(base64);
    if (floats.length === 0) return;

    const buffer = ctx.createBuffer(1, floats.length, OUTPUT_SAMPLE_RATE);
    buffer.copyToChannel(floats, 0);

    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    const startAt = Math.max(this.nextPlayTime, ctx.currentTime);
    node.start(startAt);
    this.nextPlayTime = startAt + buffer.duration;
    this.activeSources.push(node);
    this.cb.onStatusChange("speaking");

    node.onended = () => {
      this.activeSources = this.activeSources.filter((s) => s !== node);
      if (this.activeSources.length === 0 && !this.closed) {
        this.cb.onStatusChange("listening");
      }
    };
  }

  private stopPlayback() {
    for (const node of this.activeSources) {
      try {
        node.onended = null;
        node.stop();
      } catch {
        // already stopped
      }
    }
    this.activeSources = [];
    if (this.playbackCtx) this.nextPlayTime = this.playbackCtx.currentTime;
  }

  /** Sends a typed/tapped text turn into the live session, e.g. when the learner taps a suggested reply instead of speaking it. */
  sendText(text: string) {
    if (this.closed || !this.session) return;
    try {
      this.session.sendClientContent({ turns: text, turnComplete: true });
    } catch {
      // Session may have just closed mid-flight — ignore.
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  isMuted() {
    return this.muted;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.muted = true;

    try {
      this.session?.close();
    } catch {
      // ignore
    }
    this.session = null;

    this.stopPlayback();

    if (this.processor) {
      try { this.processor.disconnect(); } catch { /* ignore */ }
      this.processor = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) track.stop();
      this.micStream = null;
    }
    if (this.captureCtx) {
      void this.captureCtx.close().catch(() => {});
      this.captureCtx = null;
    }
    if (this.playbackCtx) {
      void this.playbackCtx.close().catch(() => {});
      this.playbackCtx = null;
    }
  }
}
