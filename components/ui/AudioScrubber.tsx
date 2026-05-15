"use client";

import { useEffect, useState, useRef } from "react";
import { Play, Pause, X, Repeat } from "lucide-react";
import { subscribeTTS, pauseTTS, resumeTTS, seekTTS, stopTTS, toggleRepeat, TTSState, getTTSState } from "@/lib/tts";

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function AudioScrubber() {
  const [state, setState] = useState<TTSState>({ status: "idle", currentTime: 0, duration: 0, text: "" });
  const rAFRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    let unmounted = false;
    let localState: TTSState;

    const unsubscribe = subscribeTTS((newState) => {
      localState = newState;
      if (!unmounted) {
        setState(newState);
      }
    });

    const tick = () => {
      if (!unmounted && localState && localState.status === "playing") {
        setState(getTTSState());
      }
      rAFRef.current = requestAnimationFrame(tick);
    };
    rAFRef.current = requestAnimationFrame(tick);

    return () => {
      unmounted = true;
      unsubscribe();
      if (rAFRef.current) cancelAnimationFrame(rAFRef.current);
    };
  }, []);

  const show = state.status === "playing" || state.status === "paused" || state.status === "loading";
  
  // Return null or animate out
  if (!show && state.status === "idle") return null;

  const displayTime = state.currentTime;
  const duration = state.duration || 1; // avoid / 0
  const progressPercent = Math.min(100, Math.max(0, (displayTime / duration) * 100));

  const handleDragStart = () => {
    if (state.status === "playing") {
      wasPlayingRef.current = true;
      pauseTTS();
    } else {
      wasPlayingRef.current = false;
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    seekTTS(val);
  };

  const handleDragEnd = () => {
    seekTTS(state.currentTime); // ensure exact alignment
    if (wasPlayingRef.current) {
      resumeTTS();
    }
  };

  const handleToggle = () => {
    if (state.status === "playing") pauseTTS();
    else if (state.status === "paused") resumeTTS();
  };

  return (
    <div className={`audio-scrubber-overlay ${show ? "visible" : "hidden"}`}>
      <div className="audio-scrubber-content">
        <button 
          className="audio-play-btn" 
          onClick={handleToggle}
          disabled={state.status === "loading"}
          aria-label={state.status === "playing" ? "Пауза" : "Воспроизведение"}
        >
          {state.status === "playing" ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="play-icon" />}
        </button>

        <div className="audio-progress-container">
          <div className="audio-progress-bar">
            <div className="audio-progress-fill" style={{ width: `${progressPercent}%` }} />
            <input
              type="range"
              min="0"
              max={duration}
              step="0.01"
              value={displayTime}
              onChange={handleSeek}
              onMouseDown={handleDragStart}
              onMouseUp={handleDragEnd}
              onTouchStart={handleDragStart}
              onTouchEnd={handleDragEnd}
              className="audio-progress-input"
            />
          </div>
          <div className="audio-time">
            <span>{formatTime(displayTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        <button 
          className="audio-close-btn" 
          onClick={toggleRepeat}
          aria-label="Повтор"
          style={{ 
            color: state.repeat ? 'var(--accent)' : 'inherit',
            opacity: state.repeat ? 1 : 0.6,
            marginLeft: 4,
            marginRight: -4
          }}
        >
          <Repeat size={16} />
        </button>

        <button 
          className="audio-close-btn" 
          onClick={stopTTS}
          aria-label="Остановить"
        >
          <X size={18} />
        </button>
      </div>
    </div>
  );
}
