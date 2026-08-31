import type { SubtitleCue } from "./youtubeTranscript";
import { isSubtitleCues } from "./subtitleCues";

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** No overall time/attempt limit. Each poll survives a separate serverless invocation. */
export async function loadTranscript(videoId: string, lang: string, signal: AbortSignal, onStatus: (message: string) => void): Promise<SubtitleCue[]> {
  signal.throwIfAborted();
  const cuesKey = `aibook_transcript_cues_v1:${videoId}:${lang}`;
  try {
    const cached: unknown = JSON.parse(localStorage.getItem(cuesKey) || "null");
    if (isSubtitleCues(cached)) return cached;
  } catch { /* Storage may be disabled or corrupt. */ }
  const storageKey = `aibook_native_transcript_job_v1:${videoId}:${lang}`;
  let jobId: string | undefined;
  try { jobId = sessionStorage.getItem(storageKey) || undefined; } catch { /* Storage may be disabled. */ }
  const saveJob = (id?: string) => {
    jobId = id;
    try { if (id) sessionStorage.setItem(storageKey, id); else sessionStorage.removeItem(storageKey); } catch { /* Keep the in-memory ID. */ }
  };
  let failures = 0;
  while (!signal.aborted) {
    let retryDelay = 2000;
    let terminalError: string | undefined;
    try {
      const params = new URLSearchParams({ v: videoId, lang });
      if (jobId) params.set("job", jobId);
      const response = await fetch(`/api/videos/transcript?${params}`, {
        cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
      });
      const data = await response.json();
      signal.throwIfAborted();
      if (!response.ok) {
        if (data.retryable === false || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
          terminalError = data.error || "Не удалось загрузить субтитры.";
        } else throw new Error(data.error || "Сервис временно недоступен. Продолжаем ожидание…");
      } else if (response.status === 202 || data.status === "pending") {
        if (typeof data.jobId !== "string" || !data.jobId) throw new Error("Ожидаем номер задания субтитров…");
        saveJob(data.jobId);
        failures = 0;
        onStatus("Supadata готовит субтитры. Ожидаем результат…");
      } else if (Array.isArray(data.cues)) {
        if (data.cues.length && !isSubtitleCues(data.cues)) throw new Error("Некорректные субтитры. Повторяем запрос…");
        if (isSubtitleCues(data.cues)) {
          try { localStorage.setItem(cuesKey, JSON.stringify(data.cues)); }
          catch { /* Server cache remains available if device storage is full. */ }
        }
        saveJob();
        return data.cues as SubtitleCue[];
      } else throw new Error("Некорректный ответ сервиса. Повторяем запрос…");
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      if (!jobId && error instanceof Error && (error.name === "TimeoutError" || error instanceof TypeError)) {
        throw new Error("Связь прервалась до получения номера задания. Автоповтор остановлен, чтобы не тратить кредиты повторно. Попробуйте позже.");
      }
      failures++;
      retryDelay = Math.min(30000, 2000 * 2 ** Math.min(failures, 4));
      onStatus(error instanceof Error && error.name !== "TimeoutError" ? error.message : "Загрузка задерживается. Продолжаем ожидание…");
    }
    if (terminalError) { saveJob(); throw new Error(terminalError); }
    await delay(retryDelay, signal);
  }
  throw signal.reason;
}
