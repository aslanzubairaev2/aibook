"use client";
import { Volume2 } from "lucide-react";
import { speak } from "@/lib/tts";

type Props = { text: string; lang: string; size?: number };

export function SpeakButton({ text, lang, size = 15 }: Props) {
  return (
    <button
      type="button"
      className="speak-btn"
      onClick={(e) => { e.stopPropagation(); speak(text, lang); }}
      aria-label={`Озвучить: ${text}`}
    >
      <Volume2 size={size} />
    </button>
  );
}
