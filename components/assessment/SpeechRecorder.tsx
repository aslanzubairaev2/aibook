"use client";

// A speaking task: record → stop → listen to yourself → send. The recording is
// converted to 16 kHz WAV in the browser, sent once under an id made at
// recording time (so a retry never pays for a second analysis), stored, and
// assessed by Azure on the server.
//
// What comes back is shown only when the test allows it: in learning mode at
// once, with remarks in Russian and a way to hear one's own word next to the
// sample; in diagnostic mode only «запись отправлена» until the release point.

import { useEffect, useRef, useState } from "react";
import { Mic, Play, RotateCcw, Send, Square, Volume2 } from "lucide-react";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { blobToWav16k } from "./wavEncode";
import { assessmentApi, type View, type ViewItem } from "./types";

type Props = {
  assessmentId: string;
  item: ViewItem;
  language: string;
  disabled: boolean;
  onView: (view: View) => void;
};

type Take = { blob: Blob; url: string; id: string; seconds: number };

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
}

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) => MediaRecorder.isTypeSupported(m));
}

export function SpeechRecorder({ assessmentId, item, language, disabled, onView }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "recorded" | "sending">("idle");
  const [take, setTake] = useState<Take | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const startedRef = useRef(0);

  const maxSeconds = item.max_seconds ?? 30;
  const left = Math.max(0, (item.max_recordings ?? 1) - (item.recordings_used ?? 0));
  const canRecord = !disabled && !item.locked && left > 0;

  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const stop = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Этот браузер не умеет записывать звук.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || mime || "audio/webm" });
        if (take) URL.revokeObjectURL(take.url);
        setTake({ blob, url: URL.createObjectURL(blob), id: newId(), seconds: (Date.now() - startedRef.current) / 1000 });
        setState("recorded");
      };
      recorderRef.current = recorder;
      startedRef.current = Date.now();
      setSeconds(0);
      recorder.start();
      setState("recording");
      timerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startedRef.current) / 1000;
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) stop();
      }, 200);
    } catch (err) {
      const denied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(denied ? "Нет доступа к микрофону — разрешите его в настройках браузера." : "Не удалось включить микрофон.");
    }
  };

  const send = async () => {
    if (!take) return;
    setState("sending");
    setError(null);
    try {
      const { wav } = await blobToWav16k(take.blob);
      const response = await fetch(
        `/api/assessments/${assessmentId}/speech?item_id=${encodeURIComponent(item.id)}&recording_id=${take.id}`,
        { method: "POST", headers: { "Content-Type": "audio/wav", ...(await sbAuthHeaders()) }, body: wav },
      );
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || `Ошибка ${response.status}`);
      onView(json.view as View);
      URL.revokeObjectURL(take.url);
      setTake(null);
      setState("idle");
    } catch (err) {
      // The take is kept: «Отправить» again retries the same recording id.
      setState("recorded");
      setError(err instanceof Error ? `${err.message}. Запись не потеряна — нажмите «Отправить» ещё раз.` : "Не удалось отправить запись.");
    }
  };

  const last = item.last_recording;
  return (
    <div className="asm-recorder">
      {state === "recording" ? (
        <div className="asm-rec-row">
          <button type="button" className="asm-rec-btn is-recording" onClick={stop} aria-label="Остановить запись"><Square size={26} /></button>
          <div className="asm-player-info">
            <strong>Идёт запись…</strong>
            <span className="asm-muted">{seconds.toFixed(0)} / {maxSeconds} с</span>
            <div className="asm-progress"><span style={{ width: `${Math.min(100, (seconds / maxSeconds) * 100)}%` }} /></div>
          </div>
        </div>
      ) : take ? (
        <div className="asm-rec-row">
          <audio src={take.url} controls className="asm-self-audio" />
          <div className="asm-rec-actions">
            <button type="button" className="asm-btn asm-btn-primary" onClick={send} disabled={state === "sending"}>
              <Send size={15} /> {state === "sending" ? "Оцениваем…" : "Отправить"}
            </button>
            <button type="button" className="asm-btn" onClick={() => { URL.revokeObjectURL(take.url); setTake(null); setState("idle"); }} disabled={state === "sending"}>
              <RotateCcw size={15} /> Записать заново
            </button>
          </div>
        </div>
      ) : (
        <div className="asm-rec-row">
          <button type="button" className="asm-rec-btn" onClick={start} disabled={!canRecord} aria-label="Начать запись"><Mic size={28} /></button>
          <div className="asm-player-info">
            <strong>{canRecord ? (item.recordings_used ? "Записать ещё раз" : "Нажмите и говорите") : "Записи закончились"}</strong>
            <span className="asm-muted">
              Записей осталось: {left} из {item.max_recordings} · до {maxSeconds} с
              {item.min_seconds ? ` · не меньше ${item.min_seconds} с` : ""}
            </span>
          </div>
        </div>
      )}

      {error && <p className="asm-status is-wrong">{error}</p>}
      {last?.status === "technical_error" && !take && (
        <p className="asm-status is-wrong">{last.technical_message ?? "Запись не удалось оценить."} Попытка не засчитана.</p>
      )}
      {last?.status === "done" && !item.feedback && (
        <p className="asm-status is-ok">Запись отправлена{item.recordings_used && item.max_recordings && item.recordings_used < item.max_recordings ? ". Можно перезаписать — засчитается последняя." : "."}</p>
      )}
      {item.feedback?.speech && <SpeechFeedback assessmentId={assessmentId} item={item} language={language} />}
    </div>
  );
}

function SpeechFeedback({ assessmentId, item, language }: { assessmentId: string; item: ViewItem; language: string }) {
  const speech = item.feedback!.speech!;
  const ownUrl = useRef<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [busy, setBusy] = useState(false);

  const playOwn = async (fromMs: number | null, durationMs: number | null) => {
    if (!speech.recording_id) return;
    setBusy(true);
    try {
      if (!ownUrl.current) {
        const { url } = await assessmentApi<{ url: string }>(assessmentId, { action: "speech_link", item_id: item.id, recording_id: speech.recording_id });
        ownUrl.current = URL.createObjectURL(await (await fetch(url)).blob());
      }
      audio.current?.pause();
      const a = new Audio(ownUrl.current);
      audio.current = a;
      await new Promise((resolve) => { a.onloadedmetadata = resolve; a.load(); });
      a.currentTime = Math.max(0, ((fromMs ?? 0) - 120) / 1000);
      await a.play();
      if (durationMs) {
        const stopAt = ((fromMs ?? 0) + durationMs + 200) / 1000;
        a.ontimeupdate = () => { if (a.currentTime >= stopAt) a.pause(); };
      }
    } finally {
      setBusy(false);
    }
  };

  const s = speech.scores;
  const scores = [
    ["Произношение", s.pronunciation],
    ["Точность", s.accuracy],
    ["Беглость", s.fluency],
    ["Полнота", s.completeness],
    ["Интонация", s.prosody],
  ].filter(([, v]) => v !== null) as [string, number][];
  const problems = speech.words.filter((w) => w.error_type !== "None" || (w.accuracy !== null && w.accuracy < 60));

  return (
    <div className="asm-speech">
      <div className="asm-speech-scores">
        {scores.map(([name, value]) => <span key={name}><span className="asm-muted">{name}</span> <strong>{Math.round(value)}</strong></span>)}
      </div>
      <p className="asm-muted asm-small">Баллы Azure 0–100 — оценка произношения, а не уровень языка.</p>
      {speech.transcript && <p><span className="asm-muted">Распознано:</span> {speech.transcript}</p>}
      {speech.remarks.map((r) => <p key={r}>{r}</p>)}
      {problems.length > 0 && (
        <div className="asm-speech-words">
          {problems.map((w, i) => (
            <span key={`${w.word}-${i}`} className={`asm-speech-word is-${w.error_type.toLowerCase()}`}>
              {w.word}
              {w.error_type !== "Omission" && w.offset_ms !== null && (
                <button type="button" className="asm-icon-btn" onClick={() => playOwn(w.offset_ms, w.duration_ms)} disabled={busy} title="Как сказали вы" aria-label={`Послушать себя: ${w.word}`}>
                  <Play size={13} />
                </button>
              )}
              <span title="Образец" className="asm-sample-btn"><SpeakButton text={w.word} lang={language} size={13} /></span>
            </span>
          ))}
        </div>
      )}
      <div className="asm-item-actions">
        {speech.recording_id && (
          <button type="button" className="asm-btn" onClick={() => playOwn(0, null)} disabled={busy}><Volume2 size={15} /> Моя запись</button>
        )}
        {item.text && <span className="asm-btn asm-btn-plain">Образец: <SpeakButton text={item.text} lang={language} size={15} /></span>}
      </div>
    </div>
  );
}
