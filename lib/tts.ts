import { getLocalProfile } from "./db/local";
import { DEEPGRAM_TTS_SAMPLE_RATE, getDeepgramTtsModel, isDeepgramTtsSupported, normalizeLanguageCode } from "./ttsProviders";

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

export function pauseTTS() {
  if (state.status !== "playing") return;
  const profile = getLocalProfile();
  if (profile.ttsProvider === "gemini" || profile.ttsProvider === "deepgram") {
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
  if (profile.ttsProvider === "gemini" || profile.ttsProvider === "deepgram") {
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
  if (profile.ttsProvider === "gemini" || profile.ttsProvider === "deepgram") {
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

export async function speak(
  text: string, 
  lang: string, 
  onStart?: () => void, 
  onEnd?: () => void
): Promise<PlaybackController | null> {
  const profile = getLocalProfile();
  const requestedProvider = profile.ttsProvider ?? "local";
  const provider = requestedProvider === "deepgram" && !isDeepgramTtsSupported(lang) ? "local" : requestedProvider;
  
  updateState({ status: "loading", text, currentTime: 0, duration: 0 });
  
  if (provider === "gemini" || provider === "deepgram") {
    stopRemoteAudio(true); // silent stop
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    
    let audioBase64: string | null = null;
    const voiceKey = provider === "deepgram" ? getDeepgramTtsModel(lang) : "Algenib";
    const cacheLang = normalizeLanguageCode(lang);
    
    // Check local Browser Cache API
    const cacheKey = `tts-${provider}-${voiceKey ?? "default"}-${cacheLang}-${encodeURIComponent(text)}`;
    try {
      const cache = await caches.open("aibook-tts-cache");
      const cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) {
        audioBase64 = await cachedResponse.text();
      }
    } catch(e) {}

    if (!audioBase64) {
      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, lang, provider })
        });
        
        if (res.ok) {
          const data = await res.json();
          audioBase64 = data.audioBase64;
          try {
            const cache = await caches.open("aibook-tts-cache");
            await cache.put(cacheKey, new Response(audioBase64));
          } catch(e) {}
        }
      } catch (e) {
        console.error(`${provider} TTS API failed`, e);
      }
    }

    if (audioBase64) {
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
      
      currentBuffer = currentAudioCtx.createBuffer(1, floatArray.length, DEEPGRAM_TTS_SAMPLE_RATE);
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
    } else {
      updateState({ status: "idle" });
      if (onEnd) onEnd();
      return null;
    }
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
