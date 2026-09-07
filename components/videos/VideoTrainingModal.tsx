"use client";

import { useEffect, useRef, useState } from "react";
import { X, Loader2, Mic, MicOff } from "lucide-react";
import { getAiHeaders } from "@/lib/ai/analyze";
import type { TrainingReply } from "@/lib/videos/training";
import { isSpeechRecognitionSupported, startRecognition, type Recognizer } from "@/lib/speech/recognition";
import styles from "./VideoTrainingModal.module.css";

type Props = {
  cues: string[]; videoId: string; title: string; nativeLanguage: string;
  targetLanguage: string; userId?: string | null; onClose: () => void; onDiscuss?: (cueIndex: number) => void;
  onWordTap?: (word: string, contextSentence: string) => void;
};
type Session = { index: number; prompts: Record<number, string>; answer: string; feedback: string };
const emptySession = (): Session => ({ index: 0, prompts: {}, answer: "", feedback: "" });

export default function VideoTrainingModal({ cues, videoId, nativeLanguage, targetLanguage, userId, onClose, onDiscuss, onWordTap }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const recognizerRef = useRef<Recognizer | null>(null);
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const [session, setSession] = useState<Session>(emptySession);
  const [storageKey, setStorageKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const [readyForNext, setReadyForNext] = useState(false);
  const [isDictating, setIsDictating] = useState(false);
  const [dictationError, setDictationError] = useState("");
  const [revealedAnswer, setRevealedAnswer] = useState("");
  const [correctFeedback, setCorrectFeedback] = useState(false);
  const complete = session.index >= cues.length;
  const prompt = session.prompts[session.index];

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { controller.current?.abort(); recognizerRef.current?.stop(); element?.close(); previous?.focus(); };
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
    if (action === "check") setCorrectFeedback(false);
    const abort = new AbortController();
    controller.current = abort;
    try {
      let reply: TrainingReply;
      {
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
      else if (action === "check" && reply.correct) {
        setSession(s => ({ ...s, feedback: reply.feedback }));
        setCorrectFeedback(true);
        setReadyForNext(true);
      }
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

  function advanceToNextCue() {
    if (!readyForNext || busy) return;
    setReadyForNext(false);
    setRevealedAnswer("");
    setCorrectFeedback(false);
    setSession(s => ({ ...s, index: s.index + 1, answer: "", feedback: "" }));
  }

  function revealAnswer() {
    if (busy || complete || !prompt) return;
    setRevealedAnswer(cues[session.index]);
    setCorrectFeedback(false);
    setSession(s => ({ ...s, feedback: "Вот правильная фраза из видео. Можно разобрать её с ИИ шаг за шагом." }));
    setReadyForNext(true);
  }

  function insertText(text: string) {
    const element = answerRef.current;
    if (!element) return;
    const start = element.selectionStart ?? session.answer.length;
    const end = element.selectionEnd ?? start;
    const next = `${session.answer.slice(0, start)}${text}${session.answer.slice(end)}`;
    setSession(s => ({ ...s, answer: next }));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function toggleDictation() {
    if (isDictating) {
      recognizerRef.current?.stop();
      setIsDictating(false);
      return;
    }
    if (!isSpeechRecognitionSupported()) {
      setDictationError("Диктовка не поддерживается этим браузером. Попробуйте Chrome или Edge.");
      return;
    }
    setDictationError("");
    const recognizer = startRecognition(targetLanguage, {
      onResult: (transcript) => setSession(s => ({ ...s, answer: `${s.answer}${s.answer.trim() ? " " : ""}${transcript}` })),
      onError: () => { setDictationError("Не удалось услышать речь. Разрешите микрофон и попробуйте ещё раз."); setIsDictating(false); },
      onEnd: () => { setIsDictating(false); recognizerRef.current = null; },
    });
    if (!recognizer) {
      setDictationError("Не удалось запустить микрофон. Проверьте разрешение браузера.");
      return;
    }
    recognizerRef.current = recognizer;
    setIsDictating(true);
  }

  function renderPromptWords(text: string) {
    if (!onWordTap) return text;
    return text.split(/(\s+)/u).map((part, index) => {
      if (!/\p{L}/u.test(part)) return <span key={`${part}-${index}`}>{part}</span>;
      const word = part.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");
      if (!word) return <span key={`${part}-${index}`}>{part}</span>;
      const start = part.indexOf(word);
      return <span key={`${part}-${index}`}>
        {part.slice(0, start)}
        <button type="button" className={styles.promptWord} onClick={() => onWordTap(word, text)} aria-label={`Разобрать слово ${word}`}>{word}</button>
        {part.slice(start + word.length)}
      </span>;
    });
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby="video-training-title"
    onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className={styles.header}>
      <h2 id="video-training-title" className={styles.visuallyHidden}>Тренировка перевода</h2>
      <button type="button" className={styles.icon} aria-label="Закрыть тренировку" onClick={onClose}><X size={22} /></button>
    </header>
    <progress className={styles.progress} value={session.index} max={cues.length} aria-label="Пройденные реплики" />
    {storageWarning && <p role="status">Хранилище недоступно: прогресс сохранится только до закрытия окна.</p>}
    {session.feedback && <div className={`${styles.feedback} ${correctFeedback ? styles.correctFeedback : ""}`} role="status">{session.feedback}</div>}
    {revealedAnswer && <div className={styles.revealedAnswer}>
      <span>Правильная фраза</span><strong>{revealedAnswer}</strong>
      {onDiscuss && <button type="button" onClick={() => onDiscuss(session.index)}>Разобрать фразу с ИИ</button>}
    </div>}
    {readyForNext && !complete && <button type="button" className={`${styles.nextButton} ${correctFeedback ? styles.nextCorrect : ""}`} onClick={advanceToNextCue}>
      Следующая реплика <span aria-hidden="true">→</span>
    </button>}
    {complete ? <section className={styles.exercise}><h3>Все реплики пройдены!</h3><p>Вы перевели весь текст этого видео.</p>
      <button type="button" onClick={() => { setReadyForNext(false); setSession(s => ({ ...emptySession(), prompts: s.prompts })); setError(""); }}>Повторить тренировку</button></section>
      : <form onSubmit={e => { e.preventDefault(); if (prompt && session.answer.trim()) void request("check"); }}>
        <section className={styles.exercise} aria-busy={busy}>
          <span className={styles.eyebrow}>Переведите на {targetLanguage.toUpperCase()}</span>
          <p className={styles.prompt}>{prompt ? renderPromptWords(prompt) : (busy ? "Готовим реплику…" : "Задание ещё не загружено")}</p>
        </section>
        <label className={styles.label} htmlFor="video-training-answer">Ваш перевод или вопрос к ИИ</label>
        <textarea ref={answerRef} id="video-training-answer" value={session.answer} maxLength={4000} rows={3} disabled={busy || !prompt}
          placeholder="Напишите перевод…" onChange={e => setSession(s => ({ ...s, answer: e.target.value }))}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (prompt && session.answer.trim()) void request("check");
            }
          }} />
        <div className={styles.inputTools}>
          <span className={styles.toolLabel}>Немецкие буквы:</span>
          {['ä', 'ö', 'ü', 'ß'].map(letter => <button type="button" className={styles.characterButton} key={letter} disabled={busy || !prompt} onClick={() => insertText(letter)}>{letter}</button>)}
          <button type="button" className={`${styles.micButton} ${isDictating ? styles.recording : ""}`} disabled={busy || !prompt} onClick={toggleDictation} aria-pressed={isDictating} title={isDictating ? "Остановить диктовку" : `Диктовать на ${targetLanguage}`}>
            {isDictating ? <MicOff size={17} /> : <Mic size={17} />} {isDictating ? "Слушаю…" : "Диктовать"}
          </button>
        </div>
        {dictationError && <p className={styles.error} role="alert">{dictationError}</p>}
        <div className={styles.actions}>
          <button type="submit" disabled={busy || !prompt || !session.answer.trim()}>Проверить перевод</button>
          <button type="button" disabled={busy || !prompt || readyForNext} onClick={revealAnswer}>Не знаю</button>
        </div>
      </form>}
    {busy && <p className={styles.loading} role="status"><Loader2 size={18} className="spin" /> ИИ думает…</p>}
    {error && <div className={styles.error} role="alert"><p>{error}</p>{!prompt && !complete && <button type="button" disabled={busy} onClick={() => void request("prepare")}>Повторить загрузку</button>}</div>}
  </dialog>;
}
