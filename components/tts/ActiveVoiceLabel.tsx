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
// scrolls through instead of pushing a button off the screen. The scroll runs
// one way — leftwards, on a loop, the way a ticker does. It used to slide left
// and then slide back, which reads as a fidget rather than as text going past,
// and left the beginning of a long name on screen only half the time.

import { useEffect, useRef, useState } from "react";
import { subscribeTTS, type TTSState } from "@/lib/tts";
import { getTtsProviderLabel } from "@/lib/ttsProviders";
import type { TtsProvider } from "@/lib/types";

/** Pixels per second the text travels — a readable walking pace, not a dash. */
const MARQUEE_SPEED = 24;
/** Blank run between the end of the name and the copy chasing it, in px. */
const MARQUEE_GAP = 36;

export function ActiveVoiceLabel({ className }: { className?: string }) {
  const [tts, setTts] = useState<TTSState | null>(null);
  /** Width of one copy of the text; 0 when it fits and must not move. */
  const [scrollWidth, setScrollWidth] = useState(0);
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
      // One copy's width is the travel distance (plus the gap): when it has
      // moved by exactly that, the trailing copy stands where the first one
      // started and the loop restarts without a visible seam.
      const width = text.scrollWidth;
      setScrollWidth(width - frame.clientWidth > 1 ? width : 0);
    });
    observer.observe(frame);
    observer.observe(text);
    return () => observer.disconnect();
  }, [visible, tts?.activeProvider, tts?.activeModel, tts?.fellBack]);

  // Loading counts as visible: that is when a slow engine is being waited on.
  if (!visible || !tts) return null;

  const engine = getTtsProviderLabel(tts.activeProvider as TtsProvider);
  const model = tts.activeModel;
  const scrolling = scrollWidth > 0;
  const distance = scrollWidth + MARQUEE_GAP;

  const content = (
    <>
      {tts.fellBack && <span className="active-voice-swap">замена · </span>}
      {engine}
      {model ? ` · ${model}` : ""}
    </>
  );

  return (
    <span
      ref={frameRef}
      className={`active-voice-label${scrolling ? " is-scrolling" : ""}${className ? ` ${className}` : ""}`}
      style={scrolling ? {
        "--marquee-distance": `${distance}px`,
        "--marquee-gap": `${MARQUEE_GAP}px`,
        "--marquee-duration": `${Math.max(4, distance / MARQUEE_SPEED)}s`,
      } as React.CSSProperties : undefined}
    >
      <span className="active-voice-label-track">
        <span ref={textRef} className="active-voice-label-text">{content}</span>
        {/* The copy that follows the original off the left edge, so the line
            never runs empty. Decorative — screen readers read the first one. */}
        {scrolling && <span className="active-voice-label-text" aria-hidden>{content}</span>}
      </span>
    </span>
  );
}
