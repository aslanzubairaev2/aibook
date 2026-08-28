import { GoogleGenAI, Modality, type LiveCallbacks, type LiveServerMessage, type Session } from "@google/genai";
import { appendTranscript, type LiveTranslateState, type LiveUsageMetadata } from "./liveTranslateState";
import { LIVE_TRANSLATE_MODEL } from "./liveModels";

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;

export type LiveTranslateCallbacks = {
  onState: (state: LiveTranslateState) => void;
  onSourceText: (text: string) => void;
  onUsage: (usage: LiveUsageMetadata) => void;
  onError: (kind: "mic-error" | "connection-error", message: string) => void;
};

function pcmBase64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, Math.max(-1, Math.min(1, samples[i])) * (samples[i] < 0 ? 0x8000 : 0x7fff), true);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodePcm(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const samples = new Float32Array(bytes.length / 2);
  for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / (view.getInt16(i * 2, true) < 0 ? 0x8000 : 0x7fff);
  return samples;
}

export class LiveTranslateSession {
  private readonly ai: GoogleGenAI;
  private readonly callbacks: LiveTranslateCallbacks;
  private session: Session | null = null;
  private stream: MediaStream | null = null;
  private capture: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private playback: AudioContext | null = null;
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
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    } catch {
      this.callbacks.onError("mic-error", "Разрешите доступ к микрофону в настройках браузера");
      return;
    }
    try {
      const callbacks: LiveCallbacks = {
        onmessage: (message) => this.handleMessage(message),
        onerror: () => this.callbacks.onError("connection-error", "Gemini Live разорвал соединение"),
        onclose: () => { if (!this.closed) this.callbacks.onError("connection-error", "Соединение закрыто"); },
      };
      this.session = await this.ai.live.connect({
        model: LIVE_TRANSLATE_MODEL,
        config: { responseModalities: [Modality.AUDIO], inputAudioTranscription: {}, outputAudioTranscription: {}, translationConfig: { targetLanguageCode: "ru", echoTargetLanguage: true } },
        callbacks,
      });
      if (this.closed) return;
      this.startCapture();
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
    if (content.inputTranscription?.text) this.callbacks.onSourceText(content.inputTranscription.text);
    if (content.outputTranscription?.text || message.data) this.callbacks.onState("translating");
    if (message.data) this.playChunk(message.data);
    if (content.turnComplete) this.callbacks.onState("listening");
  }

  private startCapture() {
    if (!this.stream) return;
    this.capture = new AudioContext({ sampleRate: INPUT_RATE });
    const source = this.capture.createMediaStreamSource(this.stream);
    this.processor = this.capture.createScriptProcessor(2048, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (!this.session || this.closed) return;
      try { this.session.sendRealtimeInput({ audio: { data: pcmBase64(event.inputBuffer.getChannelData(0)), mimeType: "audio/pcm;rate=16000" } }); } catch { /* socket is closing */ }
    };
    const silent = this.capture.createGain();
    silent.gain.value = 0;
    source.connect(this.processor); this.processor.connect(silent); silent.connect(this.capture.destination);
  }

  private playChunk(base64: string) {
    if (!this.playback) { this.playback = new AudioContext({ sampleRate: OUTPUT_RATE }); this.nextPlay = this.playback.currentTime; }
    const ctx = this.playback;
    const samples = decodePcm(base64);
    if (!samples.length) return;
    const buffer = ctx.createBuffer(1, samples.length, OUTPUT_RATE); buffer.copyToChannel(samples, 0);
    const node = ctx.createBufferSource(); node.buffer = buffer; node.connect(ctx.destination);
    const start = Math.max(ctx.currentTime, this.nextPlay); node.start(start); this.nextPlay = start + buffer.duration;
  }

  close() {
    this.closed = true;
    try { this.session?.close(); } catch { /* already closed */ }
    this.session = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.processor?.disconnect(); this.processor = null;
    void this.capture?.close().catch(() => undefined); this.capture = null;
    void this.playback?.close().catch(() => undefined); this.playback = null;
  }
}

export function addSourceTranscript(current: string, delta: string) { return appendTranscript(current, delta); }
