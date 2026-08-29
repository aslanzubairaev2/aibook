import { accumulateGptRealtimeUsage, type GptRealtimeUsage } from "./gptRealtimeModels";
import { calculateLiveUsage, type LiveTranslateState, type LiveUsageTotals } from "./liveTranslateState";

export type GptRealtimeCallbacks = {
  onState: (state: LiveTranslateState) => void;
  onSourceText: (text: string) => void;
  onUsage: (totals: LiveUsageTotals) => void;
  onError: (kind: "mic-error" | "connection-error", message: string) => void;
};

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

type RealtimeEvent = {
  type: string;
  delta?: string;
  response?: { usage?: GptRealtimeUsage };
  error?: { message?: string };
};

/**
 * A WebRTC session against the general-purpose gpt-realtime-2.1, steered by
 * a system prompt into acting as a pure translator — see
 * GPT_REALTIME_TRANSLATE_INSTRUCTIONS. Same WebRTC shape as
 * GptLiveTranslateSession (mic track in, translated-audio track out, JSON
 * events on an "oai-events" data channel), but this endpoint is a real
 * conversational model: it reports server-side turn boundaries
 * (response.created / response.done) instead of the translate-only
 * endpoint's continuous stream, and per-turn token usage instead of a flat
 * per-minute rate.
 */
export class GptRealtimeSession {
  private readonly token: string;
  private readonly callbacks: GptRealtimeCallbacks;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private closed = false;
  private usage: LiveUsageTotals = calculateLiveUsage();

  constructor(token: string, callbacks: GptRealtimeCallbacks) {
    this.token = token;
    this.callbacks = callbacks;
  }

  async connect() {
    this.callbacks.onState("connecting");
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
      this.callbacks.onError("mic-error", "Браузер не поддерживает WebRTC");
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      this.callbacks.onError("mic-error", "Разрешите доступ к микрофону в настройках браузера");
      return;
    }
    if (this.closed) return;

    try {
      const pc = new RTCPeerConnection();
      this.pc = pc;

      // A detached <audio> element is unreliable for playback — some
      // browsers, mobile ones especially, never actually route sound out of
      // an element that was created but never attached to the document, even
      // with autoplay set. It stays visually invisible either way (no
      // `controls`), so there is nothing to hide.
      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      document.body.appendChild(this.audioEl);
      pc.ontrack = (event) => {
        if (!this.audioEl) return;
        this.audioEl.srcObject = event.streams[0] ?? null;
        // autoplay is not guaranteed to fire on a stream attached this long
        // after the click that started the session; ask explicitly too.
        void this.audioEl.play().catch(() => undefined);
      };

      for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onopen = () => { if (!this.closed) this.callbacks.onState("listening"); };
      dc.onmessage = (event) => this.handleEvent(event.data);

      pc.onconnectionstatechange = () => {
        if (this.closed) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          this.callbacks.onError("connection-error", "Соединение потеряно");
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (this.closed) return;

      const response = await fetch(CALLS_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/sdp" },
        body: offer.sdp,
      });
      if (!response.ok) {
        this.callbacks.onError("connection-error", "Не удалось подключиться к GPT Realtime");
        return;
      }
      const answerSdp = await response.text();
      if (this.closed) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch {
      this.callbacks.onError("connection-error", "Не удалось подключиться к GPT Realtime");
    }
  }

  private handleEvent(raw: string) {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }
    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        if (event.delta) this.callbacks.onSourceText(event.delta);
        break;
      case "response.created":
        this.callbacks.onState("translating");
        break;
      case "response.done":
        this.callbacks.onState("listening");
        if (event.response?.usage) {
          this.usage = accumulateGptRealtimeUsage(this.usage, event.response.usage);
          this.callbacks.onUsage(this.usage);
        }
        break;
      case "error":
        this.callbacks.onError("connection-error", event.error?.message || "Ошибка GPT Realtime");
        break;
      default:
        break;
    }
  }

  close() {
    this.closed = true;
    if (this.dc) { this.dc.onmessage = null; this.dc.close(); this.dc = null; }
    if (this.pc) { this.pc.ontrack = null; this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.audioEl) { this.audioEl.srcObject = null; this.audioEl = null; }
  }
}
