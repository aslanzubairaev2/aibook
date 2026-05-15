import { getLocalProfile } from "./db/local";

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
  return () => listeners.delete(listener);
}

export function getTTSState(): TTSState {
  if (state.status === "playing" && currentAudioCtx && currentSource) {
    const elapsed = currentAudioCtx.currentTime - startTime;
    return { ...state, currentTime: Math.min(startOffset + elapsed, state.duration) };
  }
  return state;
}

function updateState(partial: Partial<TTSState>) {
  state = { ...state, ...partial };
  emitState();
}

function stopGeminiAudio(silent = false) {
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
  if (profile.ttsProvider === "gemini") {
    if (!isPaused && currentSource && currentAudioCtx) {
      isPaused = true;
      const elapsed = currentAudioCtx.currentTime - startTime;
      startOffset += elapsed;
      currentSource.onended = null;
      currentSource.stop();
      updateState({ status: "paused", currentTime: startOffset });
    }
  } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.pause();
    updateState({ status: "paused" });
  }
}

export function resumeTTS() {
  if (state.status !== "paused") return;
  const profile = getLocalProfile();
  if (profile.ttsProvider === "gemini") {
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
  if (profile.ttsProvider === "gemini") {
    stopGeminiAudio();
  } else if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    updateState({ status: "idle" });
  }
}

export function seekTTS(time: number) {
  if (state.status === "idle" || state.status === "loading") return;
  if (!currentBuffer || !currentAudioCtx) return;
  
  const targetTime = Math.max(0, Math.min(time, state.duration));
  
  if (state.status === "playing") {
    stopGeminiAudio(true);
    startOffset = targetTime;
    if (playSegmentFn) playSegmentFn(startOffset);
  } else if (state.status === "paused") {
    startOffset = targetTime;
    updateState({ currentTime: startOffset });
  }
}

export async function speak(
  text: string, 
  lang: string, 
  onStart?: () => void, 
  onEnd?: () => void
): Promise<PlaybackController | null> {
  const profile = getLocalProfile();
  
  updateState({ status: "loading", text, currentTime: 0, duration: 0 });
  
  if (profile.ttsProvider === "gemini") {
    stopGeminiAudio(true); // silent stop
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    
    let audioBase64: string | null = null;
    
    // Check local Browser Cache API
    const cacheKey = `tts-${lang}-${encodeURIComponent(text)}`;
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
          body: JSON.stringify({ text, lang })
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
        console.error("Gemini TTS API failed", e);
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
      
      currentBuffer = currentAudioCtx.createBuffer(1, floatArray.length, 24000);
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
            stopGeminiAudio();
            if (onEnd) onEnd();
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
            updateState({ status: "paused", currentTime: startOffset });
          }
        },
        resume: () => {
          if (isPaused && currentAudioCtx) {
            isPaused = false;
            if (playSegmentFn) playSegmentFn(startOffset);
          }
        },
        stop: () => {
          stopGeminiAudio();
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
  
  stopGeminiAudio(true);
  window.speechSynthesis.cancel();
  
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = LANG_MAP[lang] ?? lang;
  utter.rate = 0.88;
  
  utter.onstart = () => { 
    updateState({ status: "playing" });
    if (onStart) onStart(); 
  };
  utter.onend = () => { 
    updateState({ status: "idle" });
    if (onEnd) onEnd(); 
  };
  utter.onerror = () => { 
    updateState({ status: "idle" });
    if (onEnd) onEnd(); 
  };

  window.speechSynthesis.speak(utter);
  
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
