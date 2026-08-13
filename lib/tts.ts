import { getLocalProfile } from "./db/local";
import { sbAuthHeaders } from "./db/supabase";
import {
  DEEPGRAM_TTS_SAMPLE_RATE,
  getDeepgramTtsModel,
  getSpeechifyModel,
  isDeepgramTtsSupported,
  isSpeechifyTtsSupported,
  normalizeLanguageCode,
} from "./ttsProviders";

/** Cached audio is headerless PCM, so its rate rides along as a response header. */
const SAMPLE_RATE_HEADER = "X-Sample-Rate";

const LANG_MAP: Record<string, string> = {
  de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", ru: "ru-RU",
};

export type PlaybackController = {
  pause: () => void;
  resume: () => void;
  stop: () => void;
  isPlaying: () => boolean;
};

export type TTSState = {
  status: "idle" | "loading" | "playing" | "paused";
  currentTime: number;
  duration: number;
  text: string;
  activeCharIndex?: number;
  repeat?: boolean;
  autoNext?: boolean;
};

type TTSListener = (state: TTSState) => void;

let currentAudioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let startOffset = 0;
let startTime = 0;
let currentBuffer: AudioBuffer | null = null;

let isPaused = false;
let globalOnEnded: (() => void) | null = null;

let state: TTSState = {
  status: "idle",
  currentTime: 0,
  duration: 0,
  text: "",
};

/**
 * Requests already on the wire, by cache key.
 *
 * An auto-playing card can ask for the same audio twice before the first
 * answer lands (a re-render, a double tap), and each of those is a paid
 * request against a quota that a preview TTS model measures in requests, not
 * seconds. Sharing the promise makes the duplicate free.
 */
const inFlight = new Map<string, Promise<Recording | null>>();

/** The last quota refusal from the server, so the UI can explain the robot voice. */
let lastTtsError: string | null = null;

export function getLastTtsError() {
  return lastTtsError;
}

const listeners = new Set<TTSListener>();

function emitState() {
  const currentState = getTTSState();
  for (const listener of listeners) {
    listener(currentState);
  }
}

export function subscribeTTS(listener: TTSListener) {
  listeners.add(listener);
  listener(getTTSState());
  return () => { listeners.delete(listener); };
}

export function getTTSState(): TTSState {
  if (state.status === "playing" && currentAudioCtx && currentSource) {
    const elapsed = currentAudioCtx.currentTime - startTime;
    const currentTime = Math.min(startOffset + elapsed, state.duration);
    const activeCharIndex = state.duration > 0 ? Math.floor((currentTime / state.duration) * state.text.length) : 0;
    return { ...state, currentTime, activeCharIndex };
  }
  return state;
}

function updateState(partial: Partial<TTSState>) {
  state = { ...state, ...partial };
  emitState();
}

export function toggleRepeat() {
  updateState({ repeat: !state.repeat });
}

export function toggleAutoNext() {
  updateState({ autoNext: !state.autoNext });
}

function stopRemoteAudio(silent = false) {
  if (currentSource) {
    currentSource.onended = null;
    try { currentSource.stop(); } catch(e) {}
    currentSource.disconnect();
    currentSource = null;
  }
  isPaused = false;
  startOffset = 0;
  startTime = 0;
  
  if (!silent) {
    updateState({ status: "idle", currentTime: 0, duration: 0 });
    if (globalOnEnded) {
      globalOnEnded();
      globalOnEnded = null;
    }
  }
}

let playSegmentFn: ((offset: number) => void) | null = null;

/** Providers whose audio plays through the Web Audio path rather than the browser voice. */
function isRemoteProvider(provider: string | undefined): boolean {
  return provider === "gemini" || provider === "deepgram" || provider === "speechify";
}

export function pauseTTS() {
  if (state.status !== "playing") return;
  const profile = getLocalProfile();
  if (isRemoteProvider(profile.ttsProvider)) {
    if (!isPaused && currentSource && currentAudioCtx) {
      isPaused = true;
      const elapsed = currentAudioCtx.currentTime - startTime;
      startOffset += elapsed;
      currentSource.onended = null;
      currentSource.stop();
      const activeCharIndex = state.duration > 0 ? Math.floor((startOffset / state.duration) * state.text.length) : 0;
      updateState({ status: "paused", currentTime: startOffset, activeCharIndex });
    }
  } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.pause();
    updateState({ status: "paused" });
  }
}

export function resumeTTS() {
  if (state.status !== "paused") return;
  const profile = getLocalProfile();
  if (isRemoteProvider(profile.ttsProvider)) {
    if (isPaused && currentAudioCtx) {
      isPaused = false;
      if (playSegmentFn) playSegmentFn(startOffset);
    }
  } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.resume();
    updateState({ status: "playing" });
  }
}

export function stopTTS() {
  if (state.status === "idle") return;
  const profile = getLocalProfile();
  if (isRemoteProvider(profile.ttsProvider)) {
    stopRemoteAudio();
  } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    updateState({ status: "idle" });
  }
}

export function seekTTS(time: number) {
  if (state.status === "idle" || state.status === "loading") return;
  if (!currentBuffer || !currentAudioCtx) return;
  
  const targetTime = Math.max(0, Math.min(time, state.duration));
  const activeCharIndex = state.duration > 0 ? Math.floor((targetTime / state.duration) * state.text.length) : 0;
  
  if (state.status === "playing") {
    stopRemoteAudio(true);
    startOffset = targetTime;
    if (playSegmentFn) playSegmentFn(startOffset);
  } else if (state.status === "paused") {
    startOffset = targetTime;
    updateState({ currentTime: startOffset, activeCharIndex });
  }
}

/** Headerless PCM plus the rate it has to be played back at. */
type Recording = { audioBase64: string; sampleRate: number };

/**
 * The provider that can actually speak this language.
 *
 * Deepgram covers seven languages and Speechify rather more; asking either for
 * one it does not have would fail server-side, so fall back to the browser
 * voice here instead of spending the round trip to find out.
 */
function resolveProvider(requested: string, lang: string): string {
  if (requested === "deepgram" && !isDeepgramTtsSupported(lang)) return "local";
  if (requested === "speechify" && !isSpeechifyTtsSupported(lang)) return "local";
  return requested;
}

/** The voice that defines a recording's identity, per provider. */
function voiceKeyFor(provider: string, lang: string): string {
  if (provider === "deepgram") return getDeepgramTtsModel(lang) ?? "default";
  if (provider === "speechify") return getSpeechifyModel(lang);
  return "Algenib";
}

/** Cache key for one recording. Shared by `speak()` and the whole-text narration. */
function ttsCacheKey(text: string, provider: string, lang: string): string {
  return `tts-${provider}-${voiceKeyFor(provider, lang)}-${normalizeLanguageCode(lang)}-${encodeURIComponent(text)}`;
}

/** One trip to `/api/tts`, returning null (and recording why) on any failure. */
async function requestTts(
  text: string,
  lang: string,
  provider: string,
  cacheKey: string,
): Promise<Recording | null> {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
      body: JSON.stringify({ text, lang, provider }),
    });

    if (!res.ok) {
      const detail = await res.json().catch(() => null) as { error?: string } | null;
      lastTtsError = detail?.error ?? `${provider} TTS: ошибка ${res.status}`;
      console.warn(`${provider} TTS request failed with status ${res.status}: ${lastTtsError}; using local voice`);
      return null;
    }

    const data = await res.json() as { audioBase64?: string; reason?: string; sampleRate?: number };
    // A quota fallback still produces audio, but the learner deserves to know
    // the voice changed and why.
    lastTtsError = data.reason ?? null;
    if (!data.audioBase64) return null;

    const recording = { audioBase64: data.audioBase64, sampleRate: data.sampleRate ?? DEEPGRAM_TTS_SAMPLE_RATE };
    try {
      const cache = await caches.open("aibook-tts-cache");
      await cache.put(
        cacheKey,
        new Response(recording.audioBase64, { headers: { [SAMPLE_RATE_HEADER]: String(recording.sampleRate) } }),
      );
    } catch (e) {}
    return recording;
  } catch (e) {
    console.error(`${provider} TTS API failed`, e);
    lastTtsError = "Не удалось связаться с сервисом озвучки.";
    return null;
  }
}

export async function speak(
  text: string,
  lang: string,
  onStart?: () => void, 
  onEnd?: () => void
): Promise<PlaybackController | null> {
  const profile = getLocalProfile();
  const provider = resolveProvider(profile.ttsProvider ?? "local", lang);

  updateState({ status: "loading", text, currentTime: 0, duration: 0 });

  if (provider === "gemini" || provider === "deepgram" || provider === "speechify") {
    stopRemoteAudio(true); // silent stop
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }

    let recording: Recording | null = null;
    const cacheKey = ttsCacheKey(text, provider, lang);

    // Check local Browser Cache API
    try {
      const cache = await caches.open("aibook-tts-cache");
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        recording = {
          audioBase64: await cachedResponse.text(),
          // Entries cached before providers could differ carry no header.
          sampleRate: Number(cachedResponse.headers.get(SAMPLE_RATE_HEADER)) || DEEPGRAM_TTS_SAMPLE_RATE,
        };
      }
    } catch(e) {}

    if (!recording) {
      const pending = inFlight.get(cacheKey) ?? requestTts(text, lang, provider, cacheKey);
      inFlight.set(cacheKey, pending);
      try {
        recording = await pending;
      } finally {
        inFlight.delete(cacheKey);
      }
    }

    if (recording) {
      const { audioBase64, sampleRate } = recording;
      if (!currentAudioCtx) {
        currentAudioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (currentAudioCtx.state === "suspended") {
        await currentAudioCtx.resume();
      }

      const arrayBuffer = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0)).buffer;
      const view = new DataView(arrayBuffer);
      const floatArray = new Float32Array(arrayBuffer.byteLength / 2);
      for (let i = 0; i < floatArray.length; i++) {
        const int16 = view.getInt16(i * 2, true);
        floatArray[i] = int16 / (int16 < 0 ? 32768 : 32767);
      }
      
      currentBuffer = currentAudioCtx.createBuffer(1, floatArray.length, sampleRate);
      currentBuffer.copyToChannel(floatArray, 0);
      
      updateState({ duration: currentBuffer.duration });

      playSegmentFn = (offset: number) => {
        if (!currentAudioCtx || !currentBuffer) return;
        currentSource = currentAudioCtx.createBufferSource();
        currentSource.buffer = currentBuffer;
        currentSource.connect(currentAudioCtx.destination);
        currentSource.start(0, offset);
        startTime = currentAudioCtx.currentTime;
        updateState({ status: "playing" });
        
        currentSource.onended = () => {
          if (!isPaused) {
            if (state.repeat) {
              startOffset = 0;
              if (playSegmentFn) playSegmentFn(0);
            } else {
              stopRemoteAudio();
              if (onEnd) onEnd();
            }
          }
        };
      };

      globalOnEnded = onEnd || null;
      isPaused = false;
      startOffset = 0;
      
      if (onStart) onStart();
      if (playSegmentFn) playSegmentFn(0);

      return {
        pause: () => {
          if (!isPaused && currentSource && currentAudioCtx) {
            isPaused = true;
            const elapsed = currentAudioCtx.currentTime - startTime;
            startOffset += elapsed;
            currentSource.onended = null;
            currentSource.stop();
            const activeCharIndex = state.duration > 0 ? Math.floor((startOffset / state.duration) * state.text.length) : 0;
            updateState({ status: "paused", currentTime: startOffset, activeCharIndex });
          }
        },
        resume: () => {
          if (isPaused && currentAudioCtx) {
            isPaused = false;
            if (playSegmentFn) playSegmentFn(startOffset);
          }
        },
        stop: () => {
          stopRemoteAudio();
        },
        isPlaying: () => !isPaused && !!currentSource
      };
    }

    // A temporary auth/provider outage should not turn every speaker button
    // into a silent no-op. Continue into the browser voice below instead.
  }

  // Fallback to local
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    updateState({ status: "idle" });
    if (onEnd) onEnd();
    return null;
  }
  
  stopRemoteAudio(true);
  window.speechSynthesis.cancel();
  
  const startSpeech = () => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = LANG_MAP[lang] ?? lang;
    utter.rate = 0.88;
    
    // Mobile browsers don't give duration for speech, so we estimate it
    const estimatedDuration = Math.max(1, text.length / 15);
    
    let timerRef: any = null;
    let startTime = 0;

    const cleanup = () => {
      if (timerRef) {
        clearInterval(timerRef);
        timerRef = null;
      }
    };

    utter.onstart = () => { 
      startTime = Date.now();
      updateState({ status: "playing", activeCharIndex: 0, duration: estimatedDuration });
      
      // Fallback timer for browsers that don't support onboundary (like some mobile ones)
      cleanup();
      timerRef = setInterval(() => {
        if (window.speechSynthesis.paused) return;
        const elapsed = (Date.now() - startTime) / 1000;
        if (elapsed >= estimatedDuration) {
          cleanup();
          return;
        }
        
        // Only update if onboundary hasn't provided a more recent/precise index
        // Or just let them coexist, they should be roughly aligned
        const progress = Math.min(0.99, elapsed / estimatedDuration);
        updateState({ 
          activeCharIndex: Math.floor(progress * text.length),
          currentTime: elapsed
        });
      }, 100);

      if (onStart) onStart(); 
    };
    utter.onboundary = (e) => {
      const charIndex = e.charIndex;
      const progress = text.length > 0 ? charIndex / text.length : 0;
      updateState({ 
        activeCharIndex: charIndex,
        currentTime: progress * estimatedDuration
      });
    };
    utter.onend = () => { 
      cleanup();
      if (state.repeat) {
        startSpeech();
      } else {
        updateState({ status: "idle", activeCharIndex: 0 });
        if (onEnd) onEnd(); 
      }
    };
    utter.onerror = (e: any) => { 
      cleanup();
      // Ignore interrupted/canceled as they are often intentional (e.g. seeking or new speech)
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      
      console.warn("SpeechSynthesis warning", e);
      updateState({ status: "idle", activeCharIndex: 0 });
      if (onEnd) onEnd(); 
    };
    window.speechSynthesis.speak(utter);
  };
  startSpeech();
  
  return {
    pause: () => {
      window.speechSynthesis.pause();
      updateState({ status: "paused" });
    },
    resume: () => {
      window.speechSynthesis.resume();
      updateState({ status: "playing" });
    },
    stop: () => {
      window.speechSynthesis.cancel();
      updateState({ status: "idle" });
    },
    isPlaying: () => window.speechSynthesis.speaking && !window.speechSynthesis.paused
  };
}

// ─── Whole-text narration ────────────────────────────────────────────────────
//
// The TTS endpoint caps a request at 2000 characters, so a long text has to be
// sent a passage at a time. But the learner wants one recording they can play
// straight through, not eighteen fragments they have to trigger one by one.
//
// The audio comes back as raw 16-bit PCM with no container, which means the
// passages concatenate into a single continuous stream just by appending the
// bytes. Doing that and writing the result into the browser cache under the key
// `speak()` looks up for the *whole* text means the existing player then treats
// the entire text as one recording — no change to playback at all.

export type NarrationProgress = { done: number; total: number };

/** Gap between passage requests, so a whole book does not arrive as a burst. */
const PASSAGE_REQUEST_SPACING_MS = 400;

export type NarrationResult = {
  /** Passages that came back; the joined audio covers exactly these. */
  done: number;
  failed: number;
  cancelled: boolean;
  /** Seconds of audio produced, once anything was. */
  seconds: number;
  /** Set when the run stopped early because the provider refused on quota. */
  quotaError?: string;
};

/**
 * Narrate every passage and leave one joined recording ready for `speak()`.
 *
 * Passages already narrated are served from the server-side cache, so stopping
 * and resuming — or closing the app entirely — never pays for the same passage
 * twice.
 */
export async function prepareFullTextAudio(
  passages: string[],
  fullText: string,
  lang: string,
  opts: {
    authHeaders: () => Promise<Record<string, string>>;
    onProgress?: (p: NarrationProgress) => void;
    shouldCancel?: () => boolean;
  },
): Promise<NarrationResult> {
  const profile = getLocalProfile();
  // Local browser speech cannot be captured as data, so joining needs a server
  // voice; fall back to Gemini rather than producing nothing.
  const resolved = resolveProvider(profile.ttsProvider ?? "gemini", lang);
  const provider = resolved === "local" ? "gemini" : resolved;

  const chunks = passages.map((p) => p.slice(0, 2000)).filter((p) => p.trim().length > 0);
  const parts: Uint8Array[] = [];
  let done = 0;
  let failed = 0;
  let quotaError: string | undefined;
  // Every passage comes from one provider and one voice, so one rate covers the
  // joined recording; the first passage to arrive settles it.
  let sampleRate = DEEPGRAM_TTS_SAMPLE_RATE;

  for (let i = 0; i < chunks.length; i++) {
    if (opts.shouldCancel?.()) {
      return { done, failed, cancelled: true, seconds: totalSeconds(parts, sampleRate) };
    }

    let base64: string | null = null;
    const key = ttsCacheKey(chunks[i], provider, lang);

    try {
      const cache = await caches.open("aibook-tts-cache");
      const hit = await cache.match(key);
      if (hit) {
        base64 = await hit.text();
        sampleRate = Number(hit.headers.get(SAMPLE_RATE_HEADER)) || sampleRate;
      }
    } catch { /* no Cache API */ }

    if (!base64) {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(await opts.authHeaders()) },
          body: JSON.stringify({ text: chunks[i], lang, provider }),
        });
        if (res.ok) {
          const data = await res.json() as { audioBase64?: string; sampleRate?: number };
          base64 = data.audioBase64 ?? null;
          sampleRate = data.sampleRate ?? sampleRate;
          if (base64) {
            try {
              const cache = await caches.open("aibook-tts-cache");
              await cache.put(key, new Response(base64, { headers: { [SAMPLE_RATE_HEADER]: String(sampleRate) } }));
            } catch { /* cache full or unavailable */ }
          }
        } else if (res.status === 429) {
          // Once the provider is refusing on quota, the remaining passages are
          // not going to fare better — and every one of them still counts as a
          // request. Keep what was narrated and stop.
          const detail = await res.json().catch(() => null) as { error?: string } | null;
          quotaError = detail?.error ?? "Провайдер озвучки ограничил запросы (429).";
          break;
        }
      } catch { /* connection dropped on this passage only */ }
    }

    if (base64) {
      parts.push(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
      done++;
    } else {
      failed++;
    }

    opts.onProgress?.({ done: i + 1, total: chunks.length });

    // A preview TTS model counts requests, not bytes. Spacing the passages out
    // keeps a long book from spending the whole per-minute allowance in one go.
    if (i + 1 < chunks.length) {
      await new Promise((resolve) => setTimeout(resolve, PASSAGE_REQUEST_SPACING_MS));
    }
  }

  if (parts.length > 0) {
    const joined = concatBytes(parts);
    try {
      const cache = await caches.open("aibook-tts-cache");
      await cache.put(
        ttsCacheKey(fullText, provider, lang),
        new Response(bytesToBase64(joined), { headers: { [SAMPLE_RATE_HEADER]: String(sampleRate) } }),
      );
    } catch { /* cache full — playback falls back to per-passage */ }
  }

  return { done, failed, cancelled: false, seconds: totalSeconds(parts, sampleRate), quotaError };
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** 16-bit samples at the provider rate. */
function totalSeconds(parts: Uint8Array[], sampleRate: number): number {
  const bytes = parts.reduce((sum, p) => sum + p.byteLength, 0);
  return bytes / 2 / sampleRate;
}

/** btoa cannot take a whole book at once; chunk it to stay under the arg limit. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode(...bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}
