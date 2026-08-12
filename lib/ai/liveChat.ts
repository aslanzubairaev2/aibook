// Browser-only client for the Gemini Live API (real-time voice conversation).
// Connects directly from the browser to Google using the user's own Gemini
// key (the same key already kept in local storage for the rest of the app) —
// a persistent WebSocket session can't be proxied through a serverless route
// the way the other AI requests in this app are.

import { GoogleGenAI, Modality, type LiveCallbacks, type LiveServerMessage, type Session } from "@google/genai";
import type { LiveScenario } from "./liveChatExtras";


const INPUT_SAMPLE_RATE = 16000;
export const OUTPUT_SAMPLE_RATE = 24000;
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
  /**
   * What was already said, when this connection replaces a dropped one.
   * Replayed into the system instruction as a fallback for when the server
   * gave us no resumption handle to restore the real session state with —
   * either way a network blip must not cost the learner the conversation.
   */
  previousTranscript?: { role: "user" | "model"; text: string }[];
  /** Handle from the dropped session, restoring the model's own state rather than a retelling of it. */
  resumeHandle?: string;
};

export type LiveChatCallbacks = {
  onStatusChange: (status: LiveChatStatus) => void;
  /**
   * The socket closed unexpectedly after the call had been running — a mobile
   * network blip, a server-side timeout. Distinct from onError (which means
   * the call never started: bad key, no quota, refused model) because this one
   * is worth retrying silently, and that one is not.
   *
   * `wasStable` says the call had been up long enough to be a real
   * conversation rather than a connection that opens and dies immediately;
   * without it, a permanently broken setup would reconnect forever.
   */
  onDropped: (message: string, wasStable: boolean) => void;
  /** The server's latest resumption handle for this session — hand it back on reconnect to restore state exactly. */
  onSessionHandle: (handle: string) => void;
  onUserTranscript: (text: string) => void;
  onModelTranscript: (text: string) => void;
  /** Fires once, right as the model starts responding — a reliable signal that the user's turn just ended (the Live API only starts generating after detecting the end of the user's utterance server-side). */
  onUserTurnEnd: () => void;
  /** Fires once per completed model turn, driven by serverContent.turnComplete rather than by audio playback finishing, carrying every raw audio chunk so the turn can be replayed later without spending tokens on a fresh TTS call. */
  onModelTurnEnd: (audioChunks: string[]) => void;
  /** The model's turn was cut short by the user barging in — discard whatever partial transcript/audio was collected for it instead of merging it into the next turn. */
  onInterrupted: () => void;
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
  textContext?: { text: string; scenario: LiveScenario },
  previousTranscript?: { role: "user" | "model"; text: string }[]
) {
  const native = languageName(nativeLanguage);
  const target = languageName(targetLanguage);
  const levelLine = levelSummary
    ? `\nWhat we know about the learner's current level in ${target}: ${levelSummary}. Calibrate your vocabulary, grammar complexity, and pace to match this — don't speak above or condescendingly below it.`
    : "";

  // The learner's own word about which language to speak beats every rule
  // below it. Ignoring "говори по-русски" and carrying on in the target
  // language is the single most frustrating thing a tutor can do.
  const overrideLine = `\n\nAbove all: if the learner asks you to switch language — in any language, however casually ("speak ${native}", "говори по-русски", "auf Deutsch bitte") — switch immediately and stay in that language for the rest of the conversation, until they ask otherwise. Their request overrides every other instruction here. Never argue about which language to use and never explain why you were using the other one.`;

  const resumeLine = previousTranscript && previousTranscript.length > 0
    ? `\n\nThis call was interrupted by a network problem and has just been restored. Here is what had already been said — treat it as your own memory of this conversation and continue naturally from it, without restarting, re-introducing yourself, or repeating what you already said:\n${previousTranscript
        .slice(-24)
        .map((line) => `${line.role === "user" ? "Learner" : "You"}: ${line.text}`)
        .join("\n")}`
    : "";

  if (textContext) {
    const { text, scenario } = textContext;

    // Understanding the text and performing in it are different activities
    // and need opposite language rules.
    if (scenario.kind === "analyze") {
      return `You are a patient language teacher talking with a student by voice inside a reading app called AIBook. The student has just read the text below and wants to UNDERSTAND it.
The student's native language is ${native}; they are learning ${target}.

Text they are reading:
"""
${text.slice(0, 6000)}
"""

${scenario.prompt}

How to run this conversation:
- Speak ${native}. This is a lesson about the text, not speaking practice — an explanation the student has to decode is a failed explanation.
- Quote the ${target} words and sentences you are talking about, and pronounce them properly in ${target}; everything around the quote is ${native}.
- Answer exactly what was asked: if they ask why the text says one form and not another, explain that specific choice — the rule, the tense or case involved, and how the alternative would change the meaning.
- Use the text as your material: point at the actual sentences it contains rather than inventing generic examples.
- This is a voice call, so keep each answer to a few sentences and let them ask the next question. Offer more detail if they want it.
- Open by asking, in one short ${native} sentence, what in the text they'd like to go through.${levelLine}${overrideLine}${resumeLine}`;
    }

    return `You are a voice conversation partner inside a language-learning reading app called AIBook, helping the learner practice speaking ${target} using a specific text they just read.
The learner's native language is ${native} and they are learning ${target}.

Source text:
"""
${text.slice(0, 6000)}
"""

Scenario: ${scenario.prompt}
In this scenario you play: ${scenario.aiRole}. The learner plays: ${scenario.userRole}.
You drive the scene: take the initiative throughout, move the roleplay forward with your own lines and questions, and don't just react and wait — a passive partner makes the learner do all the work.

Stay in ${target} for the roleplay itself, switching to ${native} only to explain something the learner seems stuck on. Keep replies short and conversational (one or two sentences) so the learner can respond, and keep the scenario grounded in the specific details of the source text rather than drifting into generic small talk.${levelLine}${overrideLine}${resumeLine}`;
  }

  if (mode === "discuss") {
    return `You are a knowledgeable, patient language teacher having a voice conversation inside a language-learning reading app called AIBook.
The user's native language is ${native} and they are learning ${target}.
This is NOT a roleplay phone call and NOT speaking practice — the learner wants to ask you directly ABOUT the language: grammar rules, word meanings and nuances, how to say something, why a sentence is built a certain way, cultural context.
Speak ${native}. Quote ${target} words, phrases and example sentences as material — pronounced properly in ${target} — but every explanation around them is in ${native}, because understanding is the whole point here.
Keep answers focused, but don't artificially cut an explanation short if the question needs detail.${levelLine}${overrideLine}${resumeLine}`;
  }

  return `You are a warm, encouraging voice conversation partner inside a language-learning reading app called AIBook.
The user's native language is ${native} and they are learning ${target}.
Speak mostly in ${target}, at a level the learner can follow, and switch to ${native} to explain anything that seems confusing or if the learner gets stuck.
This is a live voice call, so keep replies short and conversational — usually one or two sentences — then let the user respond.
If the learner makes a meaningful mistake, gently model the correct phrase instead of lecturing them about grammar.
Ask follow-up questions to keep a natural conversation going.${levelLine}${overrideLine}${resumeLine}`;
}

// Sent as the opening turn so the AI leads instead of waiting in silence — the
// Live API only starts generating once it has received some turn, and a
// passive partner would leave the learner to make the first move every time.
function buildKickoffInstruction(nativeLanguage: string, targetLanguage: string, scenario: LiveScenario) {
  if (scenario.kind === "analyze") {
    return `[Instruction, not part of the conversation: greet the learner in one short sentence in ${languageName(nativeLanguage)} and ask what they would like to go through in this text. Don't acknowledge this instruction.]`;
  }
  return `[Instruction, not part of the conversation: begin the roleplay now. As ${scenario.aiRole}, speak first — open the scene with your first line in ${languageName(targetLanguage)}, fully in character. Don't acknowledge this instruction or wait for the learner to start.]`;
}

// After a dropped connection the transcript is already in the system
// instruction; this just tells the model that it is back and should carry on
// rather than open a new conversation.
const RESUME_INSTRUCTION =
  "[Instruction, not part of the conversation: the connection dropped and has just been restored. Continue the conversation from exactly where it stopped. Say one short sentence to pick the thread back up — in the language you were already speaking — then go on as before. Do not greet the learner again, do not re-introduce yourself, do not restart the scenario.]";

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

export function base64Pcm16ToFloat32(base64: string): Float32Array<ArrayBuffer> {
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

/** The service refused this configuration; the caller may retry with a simpler one. */
class SetupRejected extends Error {}

// How long to wait for setupComplete before treating the attempt as refused.
// Generous: a cold session on a slow mobile link can take several seconds.
const SETUP_TIMEOUT_MS = 15_000;

/** Turns a close event received before setupComplete into something a learner can act on. */
function describeSetupClose(e: { code?: number; reason?: string } | undefined): string {
  const reason = e?.reason?.trim();
  if (reason) return reason;
  switch (e?.code) {
    case 1006:
      return "Соединение разорвано без ответа сервера";
    case 1007:
    case 1008:
      return "Сервис отклонил параметры сессии";
    case 1011:
      return "Ошибка на стороне сервиса";
    default:
      return `Соединение закрыто (код ${e?.code ?? "неизвестен"})`;
  }
}

/** Manages one live voice session: mic capture → Gemini Live API → audio playback. */
export class LiveChatSession {
  private ai: GoogleGenAI;
  private session: Session | null = null;
  private cb: LiveChatCallbacks;
  private closed = false;
  private muted = false;
  /** True once the socket actually opened — separates "dropped" from "never connected". */
  private opened = false;
  /** True once the service confirmed the session with setupComplete. Only then may anything be sent. */
  private ready = false;
  private openedAt = 0;
  /** A session drops once. goAway followed by the actual close must not schedule two reconnects. */
  private dropReported = false;
  private readonly model: string;

  private micStream: MediaStream | null = null;
  private captureCtx: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;

  private playbackCtx: AudioContext | null = null;
  private nextPlayTime = 0;
  private activeSources: AudioBufferSourceNode[] = [];

  // Tracks whether the model is mid-turn, independent of audio playback —
  // turnComplete (and the first chunk of a new turn) are the authoritative
  // boundaries; playback-driven "speaking"/"listening" status is for the
  // orb animation only.
  private modelTurnActive = false;
  private currentTurnAudio: string[] = [];

  /**
   * @param model Which live model to open the session with. Resolved by the
   * caller (see lib/ai/liveModels.ts and /api/ai/live-model) rather than fixed
   * here, so a retired preview id can be replaced without a deploy.
   * @param baseUrl Points the SDK at a different endpoint. Exists so the
   * handshake and reconnect behaviour can be exercised against a stand-in
   * service in tests; production passes nothing and talks to Google.
   */
  constructor(apiKey: string, model: string, callbacks: LiveChatCallbacks, baseUrl?: string) {
    this.ai = new GoogleGenAI(baseUrl ? { apiKey, httpOptions: { baseUrl } } : { apiKey });
    this.cb = callbacks;
    this.model = model;
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

    const baseConfig = {
      responseModalities: [Modality.AUDIO],
      systemInstruction: buildSystemInstruction(
        nativeLanguage,
        targetLanguage,
        options?.mode ?? "call",
        options?.levelSummary,
        options?.textContext,
        options?.previousTranscript,
      ),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };

    const durableConfig = {
      ...baseConfig,
      // Without compression the server ends a voice session once the
      // conversation fills the context window — which is why longer calls
      // started dropping. A sliding window keeps the call alive instead,
      // trimming the oldest turns as it goes.
      contextWindowCompression: { slidingWindow: {} },
      // Ask for resumption handles so a dropped call can be restored with
      // the model's real state rather than a retelling of the transcript.
      sessionResumption: options?.resumeHandle ? { handle: options.resumeHandle } : {},
    };

    const resuming = (options?.previousTranscript?.length ?? 0) > 0 || !!options?.resumeHandle;
    const scenario = options?.textContext?.scenario;
    const openingTurn = resuming
      ? RESUME_INSTRUCTION
      : scenario
        ? buildKickoffInstruction(nativeLanguage, targetLanguage, scenario)
        : null;

    // Try the long-session config first. If the service rejects it — an
    // unsupported option, an expired resumption handle — fall back to the
    // plain one rather than leaving the learner with a phone button that
    // does nothing.
    try {
      await this.openSession(durableConfig, openingTurn);
    } catch (err) {
      if (this.closed) return;
      if (!(err instanceof SetupRejected)) throw err;
      console.warn("Live setup rejected with session options, retrying plain:", err.message);
      await this.openSession(baseConfig, openingTurn);
    }
  }

  /**
   * One connection attempt, resolved only when the service confirms the
   * session with setupComplete.
   *
   * The SDK's `connect()` resolves as soon as the WebSocket handshake is done:
   * it fires our onopen and only then sends the setup message. An open socket
   * therefore says nothing about whether the session is usable. When the
   * service turns the configuration down it simply hangs up — often with no
   * close frame at all, which the browser reports as code 1006 — and the old
   * code, having already called the call "connected" at onopen, read that as a
   * network drop and reconnected with the very same rejected configuration,
   * forever. Hence: nothing is live, nothing is sent, and no reconnect is
   * scheduled until setupComplete has actually arrived.
   */
  private openSession(config: Record<string, unknown>, openingTurn: string | null): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;

      const finishSetup = (err?: Error) => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        watchdog = null;
        if (err) reject(err);
        else resolve();
      };

      // A service that accepts the socket but never confirms the session is
      // indistinguishable from a hang; treat silence as a rejection so the
      // fallback config still gets its turn.
      watchdog = setTimeout(
        () => finishSetup(new SetupRejected("Сервис не подтвердил сессию за 15 секунд")),
        SETUP_TIMEOUT_MS,
      );

      const callbacks: LiveCallbacks = {
        onopen: () => {
          // Socket only. Nothing may be sent, and nothing is live, until the
          // service confirms the session below.
          if (this.closed) return;
          this.opened = true;
        },
        onmessage: (message) => {
          if (message.setupComplete && !this.ready) {
            this.ready = true;
            this.openedAt = Date.now();
            finishSetup();
            if (this.closed) return;
            this.cb.onStatusChange("listening");
            this.startMicCapture();
            if (openingTurn) this.sendText(openingTurn);
            return;
          }
          this.handleMessage(message);
        },
        onerror: (e) => {
          if (this.closed) return;
          if (this.ready) {
            this.reportDrop(e?.message || "Соединение прервалось");
          } else {
            finishSetup(new SetupRejected(e?.message || "Ошибка соединения с Gemini Live"));
          }
        },
        onclose: (e) => {
          if (this.closed) return;
          const abnormal = !!(e && (e.reason || (e.code && e.code !== 1000)));
          if (this.ready) {
            // Even a clean close we did not ask for ends the call: Gemini Live
            // caps session length server-side, so a long conversation hits
            // this on its own. Reconnecting is the right answer either way.
            this.reportDrop(e?.reason || (abnormal ? `Соединение закрыто (код ${e?.code})` : "Сессия завершилась"));
          } else {
            // Closed before the session was ever confirmed: the service turned
            // this configuration down. Retrying it unchanged would only fail
            // again, so this rejects instead of scheduling a reconnect.
            finishSetup(new SetupRejected(describeSetupClose(e)));
          }
        },
      };

      this.ai.live
        .connect({ model: this.model, config, callbacks })
        .then((session) => {
          // The handshake resolved after close() already ran. Close this
          // orphaned session — Gemini Live caps concurrent sessions per key,
          // so a leaked one silently blocks every future reconnect.
          if (this.closed) {
            try { session.close(); } catch { /* already gone */ }
            finishSetup();
            return;
          }
          this.session = session;
        })
        .catch((err) => finishSetup(new SetupRejected(err instanceof Error ? err.message : String(err))));
    });
  }

  /** A call that ran for a quarter of a minute was working; anything shorter is a setup that keeps failing. */
  private wasStable(): boolean {
    return this.ready && Date.now() - this.openedAt > 15_000;
  }

  private reportDrop(message: string) {
    if (this.dropReported || this.closed) return;
    this.dropReported = true;
    this.cb.onDropped(message, this.wasStable());
  }

  private handleMessage(message: LiveServerMessage) {
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.cb.onSessionHandle(message.sessionResumptionUpdate.newHandle);
    }

    // The server announces it is about to close this socket (its own limits,
    // a rolling restart). Treat it as the drop it is about to become, so the
    // reconnect starts now instead of after a silent gap.
    if (message.goAway) {
      this.reportDrop("Сервер закрывает сессию");
    }

    const serverContent = message.serverContent;
    if (!serverContent) return;

    if (serverContent.interrupted) {
      this.stopPlayback();
      this.modelTurnActive = false;
      this.currentTurnAudio = [];
      this.cb.onInterrupted();
    }

    const turnStarting = !this.modelTurnActive && (!!message.data || !!serverContent.outputTranscription?.text);
    if (turnStarting) {
      this.modelTurnActive = true;
      this.cb.onUserTurnEnd();
    }

    if (message.data) {
      this.currentTurnAudio.push(message.data);
      this.playChunk(message.data);
    }

    if (serverContent.inputTranscription?.text) {
      this.cb.onUserTranscript(stripInvisible(serverContent.inputTranscription.text));
    }
    if (serverContent.outputTranscription?.text) {
      this.cb.onModelTranscript(stripInvisible(serverContent.outputTranscription.text));
    }
    if (serverContent.turnComplete) {
      this.modelTurnActive = false;
      const audio = this.currentTurnAudio;
      this.currentTurnAudio = [];
      this.cb.onModelTurnEnd(audio);
      if (this.activeSources.length === 0) {
        this.cb.onStatusChange("listening");
      }
    }
  }

  private startMicCapture() {
    if (!this.micStream) return;
    this.captureCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    const source = this.captureCtx.createMediaStreamSource(this.micStream);
    const processor = this.captureCtx.createScriptProcessor(CAPTURE_BUFFER_SIZE, 1, 1);

    processor.onaudioprocess = (event) => {
      if (this.muted || !this.session || !this.ready) return;
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
    // Never before setupComplete: the service treats early traffic as a
    // protocol violation and hangs up without a close frame (code 1006).
    if (this.closed || !this.session || !this.ready) return;
    try {
      this.session.sendClientContent({ turns: text, turnComplete: true });
    } catch {
      // Session may have just closed mid-flight — ignore.
    }
  }

  /** Asks the AI to repeat its last line again, slower — for when natural speed is too fast to follow. */
  requestSlower() {
    this.sendText(
      "[Instruction, not part of the conversation: repeat your previous message again, in the same language and with the same meaning, but noticeably slower and more clearly so a language learner can follow every word. Don't acknowledge this instruction or mention it.]"
    );
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
    this.ready = false;

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
