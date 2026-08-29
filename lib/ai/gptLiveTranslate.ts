import { GPT_TRANSLATE_USD_PER_MINUTE } from "./gptTranslateModels";
import { calculatePerMinuteUsage, type LiveTranslateState, type LiveUsageTotals } from "./liveTranslateState";

export type GptLiveTranslateCallbacks = {
  onState: (state: LiveTranslateState) => void;
  onSourceText: (text: string) => void;
  onUsage: (totals: LiveUsageTotals) => void;
  onError: (kind: "mic-error" | "connection-error", message: string) => void;
};

const CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

/** How often the running cost estimate is pushed to the UI while connected. */
const USAGE_TICK_MS = 5000;

/**
 * gpt-realtime-translate streams continuously — there is no turn boundary
 * like Gemini's turnComplete. "Перевожу" is approximated from transcript
 * activity: it holds for this long after the last output delta before
 * falling back to "Слушаю разговор".
 */
const TRANSLATING_IDLE_MS = 1200;

type TranslationEvent = {
  type: string;
  delta?: string;
  error?: { message?: string };
};

/**
 * A WebRTC session against OpenAI's dedicated translation endpoint.
 *
 * Structurally different from Gemini's LiveTranslateSession: audio is never
 * touched as PCM here. The mic track is handed straight to an
 * RTCPeerConnection and the translated audio comes back the same way — the
 * browser's own WebRTC stack does the encoding, jitter buffering and
 * playback. Only transcript text and lifecycle events arrive as JSON, over a
 * side data channel.
 */
export class GptLiveTranslateSession {
  private readonly token: string;
  private readonly callbacks: GptLiveTranslateCallbacks;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private audioEl: HTMLAudioElement | null = null;
  private closed = false;
  private connectedAt: number | null = null;
  private usageTimer: ReturnType<typeof setInterval> | null = null;
  private translatingIdleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(token: string, callbacks: GptLiveTranslateCallbacks) {
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

      this.audioEl = document.createElement("audio");
      this.audioEl.autoplay = true;
      pc.ontrack = (event) => {
        if (this.audioEl) this.audioEl.srcObject = event.streams[0] ?? null;
      };

      for (const track of this.stream.getAudioTracks()) pc.addTrack(track, this.stream);

      const dc = pc.createDataChannel("oai-events");
      this.dc = dc;
      dc.onopen = () => {
        if (this.closed) return;
        this.connectedAt = Date.now();
        this.startUsageTimer();
        this.callbacks.onState("listening");
      };
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
        this.callbacks.onError("connection-error", "Не удалось подключиться к GPT Live Translate");
        return;
      }
      const answerSdp = await response.text();
      if (this.closed) return;
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } catch {
      this.callbacks.onError("connection-error", "Не удалось подключиться к GPT Live Translate");
    }
  }

  private handleEvent(raw: string) {
    let event: TranslationEvent;
    try {
      event = JSON.parse(raw) as TranslationEvent;
    } catch {
      return;
    }
    if (event.type === "session.input_transcript.delta" && event.delta) {
      // Raw delta, uncleaned and unaccumulated — same contract as Gemini's
      // onSourceText: the caller owns joining deltas into a running transcript.
      this.callbacks.onSourceText(event.delta);
    } else if (event.type === "session.output_transcript.delta") {
      this.callbacks.onState("translating");
      if (this.translatingIdleTimer) clearTimeout(this.translatingIdleTimer);
      this.translatingIdleTimer = setTimeout(() => {
        if (!this.closed) this.callbacks.onState("listening");
      }, TRANSLATING_IDLE_MS);
    } else if (event.type === "error") {
      this.callbacks.onError("connection-error", event.error?.message || "Ошибка GPT Live Translate");
    }
  }

  private startUsageTimer() {
    this.pushUsage();
    this.usageTimer = setInterval(() => this.pushUsage(), USAGE_TICK_MS);
  }

  private pushUsage() {
    if (!this.connectedAt) return;
    const seconds = (Date.now() - this.connectedAt) / 1000;
    this.callbacks.onUsage(calculatePerMinuteUsage(seconds, GPT_TRANSLATE_USD_PER_MINUTE));
  }

  close() {
    this.closed = true;
    this.pushUsage();
    if (this.usageTimer) { clearInterval(this.usageTimer); this.usageTimer = null; }
    if (this.translatingIdleTimer) { clearTimeout(this.translatingIdleTimer); this.translatingIdleTimer = null; }
    if (this.dc) { this.dc.onmessage = null; this.dc.close(); this.dc = null; }
    if (this.pc) { this.pc.ontrack = null; this.pc.onconnectionstatechange = null; this.pc.close(); this.pc = null; }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    if (this.audioEl) { this.audioEl.srcObject = null; this.audioEl = null; }
  }
}
