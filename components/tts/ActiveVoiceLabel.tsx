"use client";

// What is speaking, right now.
//
// The engine chosen in settings is not always the one that answers: a quota
// refusal walks the request down the fallback chain, and until now that swap
// was invisible — the voice simply changed mid-session with no explanation. So
// while audio is playing, the engine and model that actually produced it are
// named, quietly enough to ignore and clearly enough to read.

import { useEffect, useState } from "react";
import { subscribeTTS, type TTSState } from "@/lib/tts";
import { getTtsProviderLabel } from "@/lib/ttsProviders";
import type { TtsProvider } from "@/lib/types";

export function ActiveVoiceLabel({ className }: { className?: string }) {
  const [tts, setTts] = useState<TTSState | null>(null);

  useEffect(() => subscribeTTS(setTts), []);

  if (!tts) return null;
  // Loading is worth showing too: that is when a slow engine is being waited on.
  if (tts.status === "idle" || !tts.activeProvider) return null;

  const engine = getTtsProviderLabel(tts.activeProvider as TtsProvider);
  const model = tts.activeModel;

  return (
    <span className={`active-voice-label${className ? ` ${className}` : ""}`}>
      {tts.fellBack && <span className="active-voice-swap">замена · </span>}
      {engine}
      {model ? ` · ${model}` : ""}
    </span>
  );
}
