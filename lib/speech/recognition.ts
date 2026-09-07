// Thin wrapper over the Web Speech API (SpeechRecognition). Browser-only,
// best-effort: Chrome/Edge support it, Firefox/older Safari do not. Callers
// must guard with isSpeechRecognitionSupported() and provide a typed fallback.

const LANG_TAGS: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  ru: "ru-RU",
};

function getCtor(): any {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getCtor() !== null;
}

export type Recognizer = { stop: () => void };

export type RecognizerCallbacks = {
  onResult: (transcript: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

/**
 * Starts a one-shot recognition in the given language and returns a controller.
 * Returns null when the API is unavailable.
 */
export function startRecognition(lang: string, cb: RecognizerCallbacks): Recognizer | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = LANG_TAGS[lang] ?? lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  recognition.onresult = (event: any) => {
    const transcript = event.results?.[0]?.[0]?.transcript ?? "";
    if (transcript) cb.onResult(transcript.trim());
  };
  recognition.onerror = (event: any) => {
    cb.onError?.(event?.error ?? "speech-error");
  };
  recognition.onend = () => {
    cb.onEnd?.();
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return { stop: () => { try { recognition.stop(); } catch { /* ignore */ } } };
}

export type ContinuousCallbacks = {
  /** Fires once per finalized chunk of speech, in the order spoken — a pause
   * inside the segment does not end the session, unlike the one-shot form above. */
  onFinal: (transcript: string) => void;
  onError?: (message: string) => void;
  onEnd?: () => void;
};

export type ContinuousRecognizer = { stop: () => void };

/**
 * Continuous recognition: keeps listening across pauses in the same language
 * instead of stopping after the first utterance, reporting each finalized
 * chunk as it comes in. Used by the verb fast-trainer to keep the microphone
 * always on rather than a tap-to-record button per field.
 */
export function startContinuousRecognition(lang: string, cb: ContinuousCallbacks): ContinuousRecognizer | null {
  const Ctor = getCtor();
  if (!Ctor) return null;

  const recognition = new Ctor();
  recognition.lang = LANG_TAGS[lang] ?? lang;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = true;

  recognition.onresult = (event: any) => {
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (!result.isFinal) continue;
      const transcript = (result[0]?.transcript ?? "").trim();
      if (transcript) cb.onFinal(transcript);
    }
  };
  recognition.onerror = (event: any) => {
    // "no-speech" fires routinely while the mic just sits there listening for
    // the next word — not a real error, so it stays silent rather than
    // surfacing as one.
    if (event?.error === "no-speech" || event?.error === "aborted") return;
    cb.onError?.(event?.error ?? "speech-error");
  };
  recognition.onend = () => { cb.onEnd?.(); };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return { stop: () => { try { recognition.stop(); } catch { /* ignore */ } } };
}
