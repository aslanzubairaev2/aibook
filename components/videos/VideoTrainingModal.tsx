"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, GraduationCap } from "lucide-react";
import { getAiHeaders } from "@/lib/ai/analyze";
import { isExactTrainingAnswer, type TrainingReply } from "@/lib/videos/training";
import styles from "./VideoTrainingModal.module.css";

type Props = {
  cues: string[]; videoId: string; title: string; nativeLanguage: string;
  targetLanguage: string; userId?: string | null; onClose: () => void;
};
type Session = { index: number; prompts: Record<number, string>; answer: string; feedback: string };
const emptySession = (): Session => ({ index: 0, prompts: {}, answer: "", feedback: "" });

export default function VideoTrainingModal({ cues, videoId, title, nativeLanguage, targetLanguage, userId, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [session, setSession] = useState<Session>(emptySession);
  const [storageKey, setStorageKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const complete = session.index >= cues.length;
  const prompt = session.prompts[session.index];

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { controller.current?.abort(); element?.close(); previous?.focus(); };
  }, []);

  useEffect(() => {
    let disposed = false;
    // Content-addressed cache: changed transcripts never reuse stale exercises.
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(cues))).then(hash => {
      if (disposed) return;
      const digest = Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("");
      const key = `aibook_video_training_v1:${userId || "guest"}:${videoId}:${targetLanguage}:${nativeLanguage}:${digest}`;
      try {
        const saved = JSON.parse(localStorage.getItem(key) || "null");
        if (saved && Number.isInteger(saved.index) && saved.index >= 0 && saved.index <= cues.length
          && saved.prompts && typeof saved.prompts === "object" && !Array.isArray(saved.prompts)
          && Object.values(saved.prompts).every(p => typeof p === "string")
          && typeof saved.answer === "string" && typeof saved.feedback === "string") setSession(saved);
      } catch { setStorageWarning(true); }
      setStorageKey(key);
    }).catch(() => { if (!disposed) { setStorageWarning(true); setStorageKey("memory"); } });
    return () => { disposed = true; };
  }, [cues, videoId, userId, targetLanguage, nativeLanguage]);

  useEffect(() => {
    if (!storageKey || storageKey === "memory") return;
    try { localStorage.setItem(storageKey, JSON.stringify(session)); }
    catch {
      // Synchronize the UI with failure of the external browser storage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStorageWarning(true);
    }
  }, [session, storageKey]);

  async function request(action: "prepare" | "check" | "hint") {
    if (busyRef.current || complete) return;
    busyRef.current = true;
    setBusy(true); setError("");
    const abort = new AbortController();
    controller.current = abort;
    try {
      let reply: TrainingReply;
      if (action === "check" && isExactTrainingAnswer(session.answer, cues[session.index])) {
        reply = { correct: true, feedback: "Правильно! Ответ совпадает с репликой видео.", prompt: "" };
      } else {
        const response = await fetch("/api/videos/train", {
          method: "POST", headers: await getAiHeaders(),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(110000)]),
          body: JSON.stringify({ cues, index: session.index, nativeLanguage, targetLanguage, action, answer: session.answer, prompt: prompt || "" }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Не удалось получить ответ ИИ.");
        if (typeof data.prompt !== "string" || typeof data.feedback !== "string" || typeof data.correct !== "boolean"
          || (action === "prepare" && !data.prompt.trim())) throw new Error("ИИ вернул неполный ответ. Попробуйте ещё раз.");
        reply = data;
      }
      if (abort.signal.aborted) return;
      if (action === "prepare") setSession(s => ({ ...s, prompts: { ...s.prompts, [s.index]: reply.prompt } }));
      else if (action === "check" && reply.correct) setSession(s => ({ ...s, index: s.index + 1, answer: "", feedback: `✓ Реплика ${s.index + 1}: ${reply.feedback}` }));
      else setSession(s => ({ ...s, feedback: reply.feedback }));
    } catch (err) {
      if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Ошибка связи с ИИ.");
    } finally {
      busyRef.current = false;
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  // A new cue is prepared only once. Failed requests require an explicit retry.
  useEffect(() => {
    // This effect synchronizes the current cursor with an external AI request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (storageKey && !complete && !prompt) void request("prepare");
    // Request is intentionally triggered by cursor changes, never by typing or errors.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, session.index]);

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="video-training-title"
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}><GraduationCap size={17} /> Практика по видео</span>
        <h2 id="video-training-title">Переведи реплику</h2></div>
      <button type="button" className={styles.icon} aria-label="Закрыть тренировку" onClick={onClose}><X size={22} /></button>
    </header>
    <p className={styles.title}>{title}</p>
    <p className={styles.meta}>Перевод: {nativeLanguage.toUpperCase()} → {targetLanguage.toUpperCase()} · {Math.min(session.index + 1, cues.length)} / {cues.length}</p>
    <progress className={styles.progress} value={session.index} max={cues.length} aria-label="Пройденные реплики" />
    <p className={styles.note}>Тренировка по всему сохранённому тексту видео. Новые задания и подсказки используют платные запросы к ИИ.</p>
    {storageWarning && <p role="status">Хранилище недоступно: прогресс сохранится только до закрытия окна.</p>}
    {session.feedback && <div className={styles.feedback} role="status">{session.feedback}</div>}
    {complete ? <section className={styles.exercise}><h3>Все реплики пройдены!</h3><p>Вы перевели весь текст этого видео.</p>
      <button type="button" onClick={() => { setSession(s => ({ ...emptySession(), prompts: s.prompts })); setError(""); }}>Повторить тренировку</button></section>
      : <form onSubmit={e => { e.preventDefault(); if (prompt && session.answer.trim()) void request("check"); }}>
        <section className={styles.exercise} aria-busy={busy}>
          <span className={styles.eyebrow}>Переведите на {targetLanguage.toUpperCase()}</span>
          <p className={styles.prompt}>{prompt || (busy ? "Готовим реплику…" : "Задание ещё не загружено")}</p>
        </section>
        <label className={styles.label} htmlFor="video-training-answer">Ваш перевод или вопрос к ИИ</label>
        <textarea id="video-training-answer" value={session.answer} maxLength={4000} rows={3} disabled={busy || !prompt}
          placeholder="Напишите перевод…" onChange={e => setSession(s => ({ ...s, answer: e.target.value }))} />
        <div className={styles.actions}>
          <button type="submit" disabled={busy || !prompt || !session.answer.trim()}>Проверить перевод</button>
          <button type="button" disabled={busy || !prompt} onClick={() => void request("hint")}> {session.answer.trim() ? "Спросить ИИ" : "Подсказка"}</button>
        </div>
      </form>}
    {busy && <p className={styles.loading} role="status"><Loader2 size={18} className="spin" /> ИИ думает…</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!prompt && !complete && <button type="button" disabled={busy} onClick={() => void request("prepare")}>Повторить загрузку</button>}</div>}
    <p className={styles.note}>Правильный ответ открывает следующую реплику. При ошибке попробуйте ещё раз или задайте вопрос через «Спросить ИИ».</p>
  </dialog>;
}
