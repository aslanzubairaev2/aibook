"use client";
import { useState, useRef, useEffect } from "react";
import { Volume2, Loader2, Pause, Play } from "lucide-react";
import { speak, TTSState, getTTSState, subscribeTTS, pauseTTS, resumeTTS } from "@/lib/tts";

type Props = { text: string; lang: string; size?: number };

export function SpeakButton({ text, lang, size = 15 }: Props) {
  const [state, setState] = useState<TTSState>(getTTSState());

  useEffect(() => {
    return subscribeTTS((newState) => setState(newState));
  }, []);

  const isMe = state.text === text;
  const status = isMe ? state.status : "idle";

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (status === "loading") return;

    if (status === "playing") {
      pauseTTS();
      return;
    }

    if (status === "paused") {
      resumeTTS();
      return;
    }

    await speak(text, lang);
  };

  return (
    <button
      type="button"
      className={`speak-btn ${status === "loading" ? "loading-shimmer" : ""}`}
      onClick={handleClick}
      aria-label={`Озвучить: ${text}`}
      disabled={status === "loading"}
      style={{
        position: "relative",
        overflow: "hidden",
        opacity: status === "loading" ? 0.8 : 1,
        cursor: status === "loading" ? "default" : "pointer"
      }}
    >
      {status === "loading" ? (
        <Loader2 size={size} className="animate-spin" />
      ) : status === "playing" ? (
        <Pause size={size} />
      ) : status === "paused" ? (
        <Play size={size} />
      ) : (
        <Volume2 size={size} />
      )}
    </button>
  );
}
