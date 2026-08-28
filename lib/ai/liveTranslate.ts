import { GoogleGenAI, Modality, type LiveCallbacks, type LiveServerMessage, type Session } from "@google/genai";
import { appendTranscript, type LiveTranslateState, type LiveUsageMetadata } from "./liveTranslateState";
import { LIVE_TRANSLATE_MODEL } from "./liveModels";
import { LIVE_TRANSLATE_REALTIME_INPUT } from "./liveTranslateConfig";

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

/** 1024 samples at 16 kHz — one 64 ms packet on the wire, half of the old 2048-frame ScriptProcessor. */
const CAPTURE_FRAME = 1024;

/**
 * Audio capture runs on the audio thread, not the UI thread.
 *
 * With a ScriptProcessorNode every React re-render (and the transcript
 * re-renders constantly) competed with the capture callback, so packets left
 * late and the whole conversation felt laggy. An AudioWorklet is immune to
 * that: it converts to 16-bit PCM on the audio thread and transfers the buffer
 * out, leaving the main thread only the base64 encode.
 */
const CAPTURE_WORKLET_SOURCE = `
class LiveCaptureProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.frame = new Int16Array(${CAPTURE_FRAME}); this.filled = 0; }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    for (let i = 0; i < input.length; i++) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      this.frame[this.filled++] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      if (this.filled === this.frame.length) {
        const copy = this.frame.slice();
        this.port.postMessage(copy.buffer, [copy.buffer]);
        this.filled = 0;
      }
    }
    return true;
  }
}
registerProcessor("live-capture", LiveCaptureProcessor);
`;

export type LiveTranslateCallbacks = {
  onState: (state: LiveTranslateState) => void;
  onSourceText: (text: string) => void;
  onUsage: (usage: LiveUsageMetadata) => void;
  onError: (kind: "mic-error" | "connection-error", message: string) => void;
};

/** btoa needs a binary string; building it in 32k slices avoids a per-byte concat on every packet. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function pcmBase64(samples: Float32Array): string {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return bytesToBase64(new Uint8Array(pcm.buffer));
}

function decodePcm(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) {
    const value = view.getInt16(i * 2, true);
    samples[i] = value / (value < 0 ? 0x8000 : 0x7fff);
  }
  return samples;
}

export class LiveTranslateSession {
  private readonly ai: GoogleGenAI;
  private readonly callbacks: LiveTranslateCallbacks;
  private session: Session | null = null;
  private stream: MediaStream | null = null;
  private capture: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private workletUrl: string | null = null;
  private playback: AudioContext | null = null;
  private readonly playing = new Set<AudioBufferSourceNode>();
  private nextPlay = 0;
  private closed = false;

  constructor(token: string, callbacks: LiveTranslateCallbacks) {
    this.ai = new GoogleGenAI({ apiKey: token });
    this.callbacks = callbacks;
  }

  async connect() {
    this.callbacks.onState("connecting");
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      this.callbacks.onError("mic-error", "Браузер не поддерживает потоковый звук");
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      this.callbacks.onError("mic-error", "Разрешите доступ к микрофону в настройках браузера");
      return;
    }
    // Built before the socket opens: creating an AudioContext costs tens of
    // milliseconds, and paying that on the first audio packet would delay the
    // very first translated word.
    this.playback = new AudioContext({ sampleRate: OUTPUT_RATE, latencyHint: "interactive" });
    this.nextPlay = this.playback.currentTime;
    try {
      const callbacks: LiveCallbacks = {
        onmessage: (message) => this.handleMessage(message),
        onerror: () => this.callbacks.onError("connection-error", "Gemini Live разорвал соединение"),
        onclose: () => { if (!this.closed) this.callbacks.onError("connection-error", "Соединение закрыто"); },
      };
      this.session = await this.ai.live.connect({
        model: LIVE_TRANSLATE_MODEL,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          translationConfig: { targetLanguageCode: "ru", echoTargetLanguage: true },
          realtimeInputConfig: LIVE_TRANSLATE_REALTIME_INPUT,
        },
        callbacks,
      });
      if (this.closed) return;
      await this.startCapture();
      if (this.closed) return;
      this.callbacks.onState("listening");
    } catch {
      this.callbacks.onError("connection-error", "Не удалось подключиться к Gemini Live");
    }
  }

  private handleMessage(message: LiveServerMessage) {
    const usage = (message as LiveServerMessage & { usageMetadata?: LiveUsageMetadata }).usageMetadata;
    if (usage) this.callbacks.onUsage(usage);
    const content = message.serverContent;
    if (!content) return;
    // The model cut its own reply short (the speaker carried on talking).
    // Whatever is still queued belongs to a sentence nobody is waiting for —
    // playing it out would push every later phrase further behind.
    if (content.interrupted) this.flushPlayback();
    if (content.inputTranscription?.text) this.callbacks.onSourceText(content.inputTranscription.text);
    if (content.outputTranscription?.text || message.data) this.callbacks.onState("translating");
    if (message.data) this.playChunk(message.data);
    if (content.turnComplete) this.callbacks.onState("listening");
  }

  private sendAudio(base64: string) {
    if (!this.session || this.closed) return;
    try { this.session.sendRealtimeInput({ audio: { data: base64, mimeType: `audio/pcm;rate=${INPUT_RATE}` } }); } catch { /* socket is closing */ }
  }

  private async startCapture() {
    if (!this.stream) return;
    this.capture = new AudioContext({ sampleRate: INPUT_RATE, latencyHint: "interactive" });
    const source = this.capture.createMediaStreamSource(this.stream);

    if (this.capture.audioWorklet) {
      try {
        this.workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "application/javascript" }));
        await this.capture.audioWorklet.addModule(this.workletUrl);
        if (this.closed) return;
        this.worklet = new AudioWorkletNode(this.capture, "live-capture", { numberOfInputs: 1, numberOfOutputs: 0 });
        this.worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => this.sendAudio(bytesToBase64(new Uint8Array(event.data)));
        source.connect(this.worklet);
        return;
      } catch {
        // Falls through to the ScriptProcessor path below.
      }
    }

    this.processor = this.capture.createScriptProcessor(CAPTURE_FRAME, 1, 1);
    this.processor.onaudioprocess = (event) => this.sendAudio(pcmBase64(event.inputBuffer.getChannelData(0)));
    const silent = this.capture.createGain();
    silent.gain.value = 0;
    source.connect(this.processor); this.processor.connect(silent); silent.connect(this.capture.destination);
  }

  /** Drops every scheduled chunk and rewinds the play cursor to "now". */
  private flushPlayback() {
    for (const node of this.playing) { try { node.stop(); } catch { /* already finished */ } }
    this.playing.clear();
    if (this.playback) this.nextPlay = this.playback.currentTime;
  }

  private playChunk(base64: string) {
    if (!this.playback) { this.playback = new AudioContext({ sampleRate: OUTPUT_RATE, latencyHint: "interactive" }); this.nextPlay = this.playback.currentTime; }
    const ctx = this.playback;
    // A tab that was backgrounded comes back suspended; without this the queue
    // fills up and nothing is ever heard.
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    const samples = decodePcm(base64);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE); buffer.copyToChannel(samples, 0);
    const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, this.nextPlay);
    this.playing.add(node);
    node.onended = () => { this.playing.delete(node); };
    node.start(start); this.nextPlay = start + buffer.duration;
  }

  close() {
    this.closed = true;
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.flushPlayback();
    if (this.worklet) { this.worklet.port.onmessage = null; this.worklet.disconnect(); this.worklet = null; }
    if (this.workletUrl) { URL.revokeObjectURL(this.workletUrl); this.workletUrl = null; }
    this.processor?.disconnect(); this.processor = null;
    void this.capture?.close().catch(() => undefined); this.capture = null;
    void this.playback?.close().catch(() => undefined); this.playback = null;
  }
}

export function addSourceTranscript(current: string, delta: string) { return appendTranscript(current, delta); }
