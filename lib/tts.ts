import { getLocalProfile } from "./db/local";

const LANG_MAP: Record<string, string> = {
  de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", ru: "ru-RU",
};

export async function speak(text: string, lang: string) {
  const profile = getLocalProfile();
  
  if (profile.ttsProvider === "gemini") {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang })
      });
      
      if (res.ok) {
        const { audioBase64 } = await res.json();
        // audio/l16; rate=24000; channels=1 or similar. We can play base64.
        // Wait, the API returns raw pcm or wav? The notebook says audio/l16 usually, but for browser playing
        // we might need a wav header. Wait, the inlineData is base64. Is it a playable wav?
        // Let's assume it's playable wav as the quickstart uses wave module. Wait, the notebook writes it to .wav
        // and plays it, but actually the blob is raw L16 PCM. We'll play it via AudioContext.
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const arrayBuffer = Uint8Array.from(atob(audioBase64), c => c.charCodeAt(0)).buffer;
        
        // The quickstart says blob.mime_type is 'audio/l16; rate=24000; channels=1'
        // If we can't decode it with decodeAudioData (which might need a container like WAV), 
        // we might have to manually construct a WAV header, or use AudioContext createBuffer.
        // Let's construct a simple AudioBuffer for 16-bit PCM 24kHz.
        const view = new DataView(arrayBuffer);
        const floatArray = new Float32Array(arrayBuffer.byteLength / 2);
        for (let i = 0; i < floatArray.length; i++) {
          const int16 = view.getInt16(i * 2, true); // little-endian
          floatArray[i] = int16 / (int16 < 0 ? 32768 : 32767);
        }
        
        const audioBuffer = audioCtx.createBuffer(1, floatArray.length, 24000);
        audioBuffer.copyToChannel(floatArray, 0);
        
        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);
        source.start();
        return;
      }
    } catch (e) {
      console.error("Gemini TTS failed", e);
    }
  }

  // Fallback to local
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = LANG_MAP[lang] ?? lang;
  utter.rate = 0.88;
  window.speechSynthesis.speak(utter);
}
