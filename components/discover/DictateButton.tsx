"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
  disabled?: boolean;
};

/** Lets a caller start/stop listening without owning a click event — e.g. a
 * keyboard shortcut on the text field this button sits beside. */
export type DictateButtonHandle = { toggle: () => void };

/** Renders nothing where the Web Speech API is missing (Firefox, older Safari). */
export const DictateButton = forwardRef<DictateButtonHandle, Props>(function DictateButton(
  { lang, title, onText, disabled },
  ref,
) {
  const [listening, setListening] = useState(false);
  const recognizerRef = useRef<Recognizer | null>(null);
  const supported = isSpeechRecognitionSupported();

  useEffect(() => () => { recognizerRef.current?.stop(); }, []);

  const toggle = () => {
    if (disabled) return;
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

  useImperativeHandle(ref, () => ({ toggle }));

  if (!supported) return null;

  return (
    <button
      type="button"
      className={`dictate-btn ${listening ? "live" : ""}`}
      onClick={toggle}
      disabled={disabled}
      aria-label={title}
      title={title}
    >
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
    </button>
  );
});
