"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { startRecognition, isSpeechRecognitionSupported, type Recognizer } from "@/lib/speech/recognition";

type Props = {
  /**
   * Languages the mic can listen in, native first — e.g. `[nativeLanguage,
   * targetLanguage]`. The Web Speech API recognises one language per
   * session, so a small chip beside the mic lets the learner say which one
   * they are about to speak, cycling through this list.
   */
  languages: string[];
  onResult: (text: string) => void;
};

/** Renders nothing where the Web Speech API is missing (Firefox, older Safari). */
export function SearchVoiceButton({ languages, onResult }: Props) {
  const [langIndex, setLangIndex] = useState(0);
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef<Recognizer | null>(null);
  const supported = isSpeechRecognitionSupported();

  useEffect(() => () => { recognizerRef.current?.stop(); }, []);

  if (!supported || languages.length === 0) return null;

  const lang = languages[langIndex % languages.length] ?? languages[0];

  function toggle() {
    if (listening) {
      recognizerRef.current?.stop();
      recognizerRef.current = null;
      setListening(false);
      return;
    }
    const rec = startRecognition(lang, {
      onResult,
      onEnd: () => { recognizerRef.current = null; setListening(false); },
      onError: () => { recognizerRef.current = null; setListening(false); },
    });
    if (rec) { recognizerRef.current = rec; setListening(true); }
  }

  return (
    <span className="search-voice-wrap">
      <button
        type="button"
        className={`dictate-btn dictate-btn-sm${listening ? " live" : ""}`}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        aria-label={listening ? "Остановить голосовой ввод" : `Голосовой поиск (${lang.toUpperCase()})`}
        title={listening ? "Слушаю…" : `Голосовой поиск — ${lang.toUpperCase()}`}
      >
        {listening ? <MicOff size={13} /> : <Mic size={13} />}
      </button>
      {languages.length > 1 && (
        <button
          type="button"
          className="search-voice-lang"
          onClick={(e) => { e.stopPropagation(); setLangIndex((i) => (i + 1) % languages.length); }}
          aria-label="Сменить язык распознавания"
          title="Сменить язык распознавания перед следующей записью"
          disabled={listening}
        >
          {lang.toUpperCase()}
        </button>
      )}
    </span>
  );
}
