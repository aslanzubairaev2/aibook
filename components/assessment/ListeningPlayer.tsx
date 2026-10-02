"use client";

// The listening player of a test.
//
// Rules, kept the same as the server's (and documented for the teacher in
// get_assessment_capabilities):
//  - a play is counted when sound actually starts («playing»), on the server;
//    a failed download or a decode error before that costs nothing;
//  - pause and resume continue the same play; there is no seeking;
//  - when the recording ends, the next start is a new play;
//  - with no plays left the button locks; the counter survives reloads and
//    other devices because it lives on the server.

import { useEffect, useRef, useState } from "react";
import { Gauge, Lock, Pause, Play, RotateCcw } from "lucide-react";
import { ApiError, assessmentApi, type AudioStimulusView, type View } from "./types";

type Props = {
  assessmentId: string;
  /** A section id, or item:<id> for a repeat task's sample. */
  sectionId: string;
  stimulus: AudioStimulusView;
  closed: boolean;
  onView: (view: View) => void;
  /** Overrides «Монолог» / «Диалог…». */
  label?: string;
};

// Slower playback is the learner's own aid: the recording is the same, only
// played slower, with the pitch kept (preservesPitch is the browsers' default).
const RATES = [1, 0.85, 0.7];
const RATE_KEY = "aibook:assessment-playback-rate";

function savedRate(): number {
  try {
    const value = Number(window.localStorage.getItem(RATE_KEY));
    return RATES.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ListeningPlayer({ assessmentId, sectionId, stimulus, closed, onView, label }: Props) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  // Set once the current play has been counted on the server; cleared at the end.
  const countedRef = useRef(false);
  const allowedTimeRef = useRef(0);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [error, setError] = useState<string | null>(null);
  const [time, setTime] = useState({ current: 0, total: (stimulus.duration_ms ?? 0) / 1000 });
  const [pollTick, setPollTick] = useState(0);
  const [rate, setRate] = useState<number>(() => (typeof window === "undefined" ? 1 : savedRate()));

  const changeRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
    try { window.localStorage.setItem(RATE_KEY, String(next)); } catch { /* the choice just is not remembered */ }
  };

  const limited = stimulus.max_plays !== null;
  const midPlay = state === "playing" || state === "paused";
  const exhausted = limited && (stimulus.remaining ?? 0) <= 0 && !midPlay;
  const ready = stimulus.audio_status === "ready";

  useEffect(() => () => {
    audioRef.current?.pause();
    if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
  }, []);

  // A recording still being made: nudge the server once, then look again
  // every few seconds until it is there.
  useEffect(() => {
    if (ready || closed) return;
    let cancelled = false;
    const run = async () => {
      try {
        const { view } = await assessmentApi(assessmentId, pollTick === 0 ? { action: "retry_audio", section_id: sectionId } : { action: "open" });
        if (!cancelled) onView(view);
      } catch { /* the next tick tries again */ }
      if (!cancelled) window.setTimeout(() => setPollTick((t) => t + 1), 6000);
    };
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, closed, pollTick]);

  const ensureAudio = async (): Promise<HTMLAudioElement> => {
    if (audioRef.current && blobUrlRef.current) return audioRef.current;
    const { url } = await assessmentApi<{ url: string }>(assessmentId, { action: "audio_url", section_id: sectionId });
    const response = await fetch(url);
    if (!response.ok) throw new Error("Не удалось загрузить запись.");
    const blob = await response.blob();
    blobUrlRef.current = URL.createObjectURL(blob);
    const audio = new Audio(blobUrlRef.current);
    audio.preload = "auto";
    audio.playbackRate = rate;
    audio.addEventListener("timeupdate", () => {
      allowedTimeRef.current = audio.currentTime;
      setTime({ current: audio.currentTime, total: audio.duration || 0 });
    });
    audio.addEventListener("loadedmetadata", () => setTime({ current: 0, total: audio.duration || 0 }));
    // No seeking: a jump (media keys, a lock-screen scrubber) is put back.
    audio.addEventListener("seeking", () => {
      if (Math.abs(audio.currentTime - allowedTimeRef.current) > 1) audio.currentTime = allowedTimeRef.current;
    });
    audio.addEventListener("playing", () => {
      setState("playing");
      if (countedRef.current) return;
      countedRef.current = true;
      void assessmentApi<{ used: number; view: View }>(assessmentId, { action: "listen_start", section_id: sectionId })
        .then(({ view }) => onView(view))
        .catch((err) => {
          // The server said no (limit reached on another device): stop here.
          countedRef.current = false;
          audio.pause();
          audio.currentTime = 0;
          setState("idle");
          setError(err instanceof Error ? err.message : "Прослушивания закончились.");
        });
    });
    audio.addEventListener("pause", () => { if (!audio.ended) setState("paused"); });
    audio.addEventListener("ended", () => {
      countedRef.current = false;
      allowedTimeRef.current = 0;
      audio.currentTime = 0;
      setState("idle");
    });
    audio.addEventListener("error", () => {
      setState("idle");
      setError("Ошибка воспроизведения — попытка не потрачена, попробуйте ещё раз.");
      // An error before sound means nothing was counted; drop the broken file.
      if (!countedRef.current && blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
        audioRef.current = null;
      }
    });
    audioRef.current = audio;
    return audio;
  };

  const toggle = async () => {
    setError(null);
    const current = audioRef.current;
    if (current && state === "playing") { current.pause(); return; }
    if (exhausted) return;
    try {
      setState((s) => (s === "paused" ? s : "loading"));
      const audio = await ensureAudio();
      audio.playbackRate = rate;
      await audio.play();
    } catch (err) {
      setState(countedRef.current ? "paused" : "idle");
      if (err instanceof ApiError && err.status === 425) setError("Запись ещё готовится.");
      else setError(err instanceof Error ? err.message : "Не удалось воспроизвести запись.");
    }
  };

  const progress = time.total > 0 ? Math.min(100, (time.current / time.total) * 100) : 0;
  const counter = !limited
    ? "Можно слушать сколько угодно"
    : midPlay
      ? `Идёт прослушивание ${stimulus.used} из ${stimulus.max_plays}`
      : `Осталось прослушиваний: ${stimulus.remaining} из ${stimulus.max_plays}`;

  return (
    <div className="asm-player">
      <div className="asm-player-row">
        <button
          type="button"
          className={`asm-play${exhausted ? " is-locked" : ""}`}
          onClick={toggle}
          disabled={!ready || exhausted || state === "loading" || (closed && limited)}
          aria-label={state === "playing" ? "Пауза" : "Слушать"}
        >
          {exhausted ? <Lock size={30} /> : state === "playing" ? <Pause size={34} /> : state === "idle" && stimulus.used > 0 ? <RotateCcw size={30} /> : <Play size={34} />}
        </button>
        <div className="asm-player-info">
          <div className="asm-player-title">
            <strong>{label ?? (stimulus.kind === "dialogue" ? `Диалог${stimulus.speakers.length ? `: ${stimulus.speakers.join(", ")}` : ""}` : "Монолог")}</strong>
            <button type="button" className="asm-rate" onClick={changeRate} aria-label="Скорость воспроизведения" title="Скорость воспроизведения">
              <Gauge size={14} /> {rate === 1 ? "1×" : `${String(rate).replace(".", ",")}×`}
            </button>
          </div>
          <span className={exhausted ? "asm-status is-wrong" : "asm-muted"}>
            {!ready
              ? stimulus.audio_status === "error" ? "Запись не получилась, пробуем снова…" : "Аудио готовится…"
              : exhausted ? "Прослушивания закончились" : counter}
          </span>
          <div className="asm-progress" aria-hidden="true"><span style={{ width: `${progress}%` }} /></div>
          <span className="asm-muted asm-small">{formatTime(time.current)} / {formatTime(time.total)}</span>
        </div>
      </div>
      {error && <p className="asm-status is-wrong">{error}</p>}
      {stimulus.transcript && (
        <details className="asm-transcript">
          <summary>Текст записи</summary>
          {stimulus.transcript.map((line, i) => (
            <p key={i}>{line.speaker && <strong>{line.speaker}: </strong>}{line.text}</p>
          ))}
        </details>
      )}
    </div>
  );
}
