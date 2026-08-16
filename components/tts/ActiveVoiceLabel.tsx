"use client";

// What is speaking, right now.
//
// The engine chosen in settings is not always the one that answers: a quota
// refusal walks the request down the fallback chain, and until now that swap
// was invisible — the voice simply changed mid-session with no explanation. So
// while audio is playing, the engine and model that actually produced it are
// named, quietly enough to ignore and clearly enough to read.
//
// It sits in a player that has to fit a phone, so it never takes a width of its
// own: it fills whatever the controls leave over, and a name too long for that
// scrolls through instead of pushing a button off the screen.

import { useEffect, useRef, useState } from "react";
import { subscribeTTS, type TTSState } from "@/lib/tts";
import { getTtsProviderLabel } from "@/lib/ttsProviders";
import type { TtsProvider } from "@/lib/types";

/** Pixels per second the text travels — a readable walking pace, not a dash. */
const MARQUEE_SPEED = 24;

export function ActiveVoiceLabel({ className }: { className?: string }) {
  const [tts, setTts] = useState<TTSState | null>(null);
  /** How far the text overruns its box; 0 when it fits and must not move. */
  const [overflow, setOverflow] = useState(0);
  const frameRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);

  useEffect(() => subscribeTTS(setTts), []);

  // Whether anything is on screen to measure. It has to be known before the
  // effect below rather than after it: the label unmounts its spans whenever
  // playback stops, so a second play of the same engine renders fresh nodes
  // that the observer would otherwise never be re-attached to.
  const visible = Boolean(tts && tts.status !== "idle" && tts.activeProvider);

  useEffect(() => {
    const frame = frameRef.current;
    const text = textRef.current;
    if (!frame || !text) return;

    // The observer fires once on observe, so the first measurement arrives
    // through the callback rather than from the effect body — which keeps this
    // a subscription to the layout rather than a render that triggers a render.
    const observer = new ResizeObserver(() => {
      const spare = text.scrollWidth - frame.clientWidth;
      setOverflow(spare > 1 ? spare : 0);
    });
    observer.observe(frame);
    observer.observe(text);
    return () => observer.disconnect();
  }, [visible, tts?.activeProvider, tts?.activeModel, tts?.fellBack]);

  // Loading counts as visible: that is when a slow engine is being waited on.
  if (!visible || !tts) return null;

  const engine = getTtsProviderLabel(tts.activeProvider as TtsProvider);
  const model = tts.activeModel;

  return (
    <span
      ref={frameRef}
      className={`active-voice-label${overflow ? " is-scrolling" : ""}${className ? ` ${className}` : ""}`}
      style={overflow ? {
        "--marquee-shift": `${-overflow}px`,
        "--marquee-duration": `${Math.max(4, (overflow / MARQUEE_SPEED) * 2)}s`,
      } as React.CSSProperties : undefined}
    >
      <span ref={textRef} className="active-voice-label-text">
        {tts.fellBack && <span className="active-voice-swap">замена · </span>}
        {engine}
        {model ? ` · ${model}` : ""}
      </span>
    </span>
  );
}
