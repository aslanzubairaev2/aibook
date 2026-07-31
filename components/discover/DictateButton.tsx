"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { startRecognition, isSpeechRecognitionSupported, type Recognizer } from "@/lib/speech/recognition";

/** Appends dictated text rather than replacing, so speaking twice adds to what is there. */
export function appendSpoken(previous: string, spoken: string): string {
  const base = previous.trim();
  return base ? `${base} ${spoken}` : spoken;
}

type Props = {
  /** Language to recognise; lesson topics and notes are written in the native language. */
  lang: string;
  title: string;
  onText: (text: string) => void;
};

/** Renders nothing where the Web Speech API is missing (Firefox, older Safari). */
export function DictateButton({ lang, title, onText }: Props) {
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef<Recognizer | null>(null);
  const supported = isSpeechRecognitionSupported();

  useEffect(() => () => { recognizerRef.current?.stop(); }, []);

  if (!supported) return null;

  const toggle = () => {
    if (listening) {
      recognizerRef.current?.stop();
      recognizerRef.current = null;
      setListening(false);
      return;
    }
    const rec = startRecognition(lang, {
      onResult: onText,
      onEnd: () => { recognizerRef.current = null; setListening(false); },
      onError: () => { recognizerRef.current = null; setListening(false); },
    });
    if (rec) { recognizerRef.current = rec; setListening(true); }
  };

  return (
    <button
      type="button"
      className={`dictate-btn ${listening ? "live" : ""}`}
      onClick={toggle}
      aria-label={title}
      title={title}
    >
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
    </button>
  );
}
