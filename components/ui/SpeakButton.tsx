"use client";
import { useState, useRef, useEffect } from "react";
import { Volume2, Loader2, Pause, Play } from "lucide-react";
import { speak, PlaybackController } from "@/lib/tts";

type Props = { text: string; lang: string; size?: number };

export function SpeakButton({ text, lang, size = 15 }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const controllerRef = useRef<PlaybackController | null>(null);

  useEffect(() => {
    return () => {
      // Clean up if unmounted
      if (controllerRef.current) {
        controllerRef.current.stop();
      }
    };
  }, []);

  const handleClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (status === "loading") return;

    if (status === "playing") {
      controllerRef.current?.pause();
      setStatus("paused");
      return;
    }

    if (status === "paused") {
      controllerRef.current?.resume();
      setStatus("playing");
      return;
    }

    setStatus("loading");
    
    const controller = await speak(
      text, 
      lang,
      () => setStatus("playing"),
      () => setStatus("idle")
    );
    
    if (controller) {
      controllerRef.current = controller;
    } else {
      setStatus("idle");
    }
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
