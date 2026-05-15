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

let currentAudioCtx: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let startOffset = 0;
let startTime = 0;
let currentBuffer: AudioBuffer | null = null;

let isPaused = false;
let globalOnEnded: (() => void) | null = null;

function stopGeminiAudio() {
  if (currentSource) {
    currentSource.onended = null;
    try { currentSource.stop(); } catch(e) {}
    currentSource.disconnect();
    currentSource = null;
  }
  isPaused = false;
  startOffset = 0;
  startTime = 0;
  if (globalOnEnded) {
    globalOnEnded();
    globalOnEnded = null;
  }
}

export async function speak(
  text: string, 
  lang: string, 
  onStart?: () => void, 
  onEnd?: () => void
): Promise<PlaybackController | null> {
  const profile = getLocalProfile();
  
  if (profile.ttsProvider === "gemini") {
    stopGeminiAudio();
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
      
      const playSegment = (offset: number) => {
        if (!currentAudioCtx || !currentBuffer) return;
        currentSource = currentAudioCtx.createBufferSource();
        currentSource.buffer = currentBuffer;
        currentSource.connect(currentAudioCtx.destination);
        currentSource.start(0, offset);
        startTime = currentAudioCtx.currentTime;
        
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
      playSegment(0);

      return {
        pause: () => {
          if (!isPaused && currentSource && currentAudioCtx) {
            isPaused = true;
            const elapsed = currentAudioCtx.currentTime - startTime;
            startOffset += elapsed;
            currentSource.onended = null;
            currentSource.stop();
          }
        },
        resume: () => {
          if (isPaused && currentAudioCtx) {
            isPaused = false;
            playSegment(startOffset);
          }
        },
        stop: () => {
          stopGeminiAudio();
        },
        isPlaying: () => !isPaused && !!currentSource
      };
    } else {
      if (onEnd) onEnd();
      return null;
    }
  }

  // Fallback to local
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    if (onEnd) onEnd();
    return null;
  }
  
  stopGeminiAudio();
  window.speechSynthesis.cancel();
  
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = LANG_MAP[lang] ?? lang;
  utter.rate = 0.88;
  
  utter.onstart = () => { if (onStart) onStart(); };
  utter.onend = () => { if (onEnd) onEnd(); };
  utter.onerror = () => { if (onEnd) onEnd(); };

  window.speechSynthesis.speak(utter);
  
  return {
    pause: () => window.speechSynthesis.pause(),
    resume: () => window.speechSynthesis.resume(),
    stop: () => window.speechSynthesis.cancel(),
    isPlaying: () => window.speechSynthesis.speaking && !window.speechSynthesis.paused
  };
}
