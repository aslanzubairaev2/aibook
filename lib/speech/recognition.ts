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
