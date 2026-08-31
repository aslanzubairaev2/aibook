"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { getAiHeaders } from "@/lib/ai/analyze";
import { addDictationUsage, DICTATION_MAX_SECONDS, DICTATION_SAMPLE_RATE, dictationSeconds, encodeDictationWav } from "./dictation";

type Phase = "idle" | "requesting" | "recording" | "transcribing";
const subscribeSupport = () => () => {};
const getSupport = () => typeof navigator.mediaDevices?.getUserMedia === "function"
  && typeof window.MediaRecorder === "function" && typeof window.AudioContext === "function" && typeof window.OfflineAudioContext === "function";
const getServerSupport = () => false;
type Recording = {
  cancelled: boolean; stream?: MediaStream; recorder?: MediaRecorder;
  context?: AudioContext; timer?: ReturnType<typeof setTimeout>; ticker?: ReturnType<typeof setInterval>;
  abort: AbortController;
};

function release(recording: Recording) {
  clearTimeout(recording.timer); clearInterval(recording.ticker);
  recording.stream?.getTracks().forEach(track => track.stop());
  recording.stream = undefined;
}

export function useGeminiDictation(isOpen: boolean, context: string, onText: (text: string) => void) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [submittedSeconds, setSubmittedSeconds] = useState(0);
  const supported = useSyncExternalStore(subscribeSupport, getSupport, getServerSupport);
  const current = useRef<Recording | null>(null);
  const onTextRef = useRef(onText);
  useEffect(() => { onTextRef.current = onText; }, [onText]);

  const cancel = useCallback(() => {
    const recording = current.current;
    if (recording) {
      recording.cancelled = true; recording.abort.abort();
      if (recording.recorder?.state === "recording") recording.recorder.stop();
      release(recording);
      void recording.context?.close().catch(() => {});
      current.current = null;
    }
    setPhase("idle");
  }, []);

  useEffect(() => {
    const handleVisibility = () => { if (document.hidden) cancel(); };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => { document.removeEventListener("visibilitychange", handleVisibility); cancel(); };
  }, [isOpen, context, cancel]);

  const toggle = useCallback(async () => {
    if (current.current) {
      if (current.current.recorder?.state === "recording") current.current.recorder.stop();
      return;
    }
    if (!isOpen) return;
    const recording: Recording = { cancelled: false, abort: new AbortController() };
    current.current = recording;
    setError(""); setSeconds(0); setPhase("requesting");
    const fail = (message: string) => {
      if (!recording.cancelled) { setError(message); setPhase("idle"); }
      release(recording); void recording.context?.close().catch(() => {});
      if (current.current === recording) current.current = null;
    };
    try {
      // Create/resume on the user's gesture for Safari.
      recording.context = new AudioContext();
      void recording.context.resume().catch(() => {});
      recording.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }, video: false });
      if (recording.cancelled) { release(recording); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(recording.stream, mimeType ? { mimeType } : undefined);
      recording.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = event => {
        if (recording.cancelled || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > 8 * 1024 * 1024) { cancel(); setError("Запись слишком большая."); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => { if (!recording.cancelled) { cancel(); setError("Ошибка записи микрофона."); } };
      recorder.onstop = async () => {
        release(recording); // Microphone stops BEFORE decoding/uploading.
        if (recording.cancelled) return;
        setPhase("transcribing");
        try {
          const raw = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
          const decoded = await recording.context!.decodeAudioData(raw);
          if (recording.cancelled) return;
          if (decoded.duration > DICTATION_MAX_SECONDS + 1) throw new Error("Запись длиннее 60 секунд. Она не отправлена.");
          const frames = Math.min(Math.ceil(decoded.duration * DICTATION_SAMPLE_RATE), DICTATION_MAX_SECONDS * DICTATION_SAMPLE_RATE);
          if (frames < DICTATION_SAMPLE_RATE * 0.3) throw new Error("Запись слишком короткая.");
          const offline = new OfflineAudioContext(1, frames, DICTATION_SAMPLE_RATE);
          const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
          const rendered = await offline.startRendering();
          if (recording.cancelled) return;
          const wav = encodeDictationWav(rendered.getChannelData(0));
          const form = new FormData();
          form.set("audio", new Blob([wav], { type: "audio/wav" }), "dictation.wav");
          form.set("context", context.slice(0, 1200));
          const headers = await getAiHeaders(); delete headers["Content-Type"];
          if (recording.cancelled) return;
          setSubmittedSeconds(addDictationUsage(dictationSeconds(wav)));
          const response = await fetch("/api/ai/transcribe", {
            method: "POST", headers, body: form,
            signal: AbortSignal.any([recording.abort.signal, AbortSignal.timeout(50000)]),
          });
          const data = await response.json();
          if (recording.cancelled) return;
          if (!response.ok) throw new Error(data.error || "Не удалось распознать запись.");
          if (typeof data.text !== "string" || !data.text.trim()) throw new Error("Речь не распознана.");
          onTextRef.current(data.text.trim()); // Draft only. Never send a chat message here.
          setPhase("idle");
        } catch (err) {
          if (!recording.cancelled) setError(err instanceof Error && err.name !== "TimeoutError" ? err.message : "Распознавание прервалось. Автоповтор отключён.");
          if (!recording.cancelled) setPhase("idle");
        } finally {
          chunks.length = 0;
          void recording.context?.close().catch(() => {});
          if (current.current === recording) current.current = null;
        }
      };
      recorder.start(250);
      const started = Date.now();
      setPhase("recording");
      recording.ticker = setInterval(() => setSeconds(Math.min(DICTATION_MAX_SECONDS, Math.floor((Date.now() - started) / 1000))), 250);
      recording.timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, DICTATION_MAX_SECONDS * 1000);
    } catch (err) {
      fail(err instanceof DOMException && err.name === "NotAllowedError" ? "Разрешите доступ к микрофону в браузере." : "Не удалось включить микрофон.");
    }
  }, [isOpen, context, cancel]);

  return { phase, busy: phase !== "idle", error, seconds, submittedSeconds, supported, toggle, cancel };
}
