"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ListPlus, LoaderCircle, Mic, Plus, Sparkles, X } from "lucide-react";
import { getAiHeaders } from "@/lib/ai/analyze";
import { useGeminiDictation } from "@/lib/audio/useGeminiDictation";

export type SmartAddResult = {
  batchId: string;
  batchTitle: string;
  added: number;
  updated: number;
  cardsCreated: number;
  total: number;
  rounds: number;
  complete: boolean;
  warning?: string;
};

type Props = {
  isOpen: boolean;
  targetLanguage: string;
  nativeLanguage: string;
  batch?: { id: string; title: string } | null;
  onClose: () => void;
  onCompleted: (result: SmartAddResult) => void;
};

type Tab = "single" | "topic";
type InputLanguage = "auto" | "target" | "native";
type JobStatus = "queued" | "running" | "waiting_input" | "completed" | "failed";

type SmartJobSnapshot = {
  id: string;
  status: JobStatus;
  mode: Tab;
  request: string;
  batch_id: string | null;
  batch_title: string;
  current_action: string;
  rounds_completed: number;
  total_added: number;
  last_words: string[];
  clarification: string | null;
  error: string | null;
  result: SmartAddResult | null;
};

const languageName: Record<string, string> = {
  de: "немецкий", en: "английский", ru: "русский", es: "испанский", fr: "французский",
};

function isRunning(status: JobStatus | undefined): boolean {
  return status === "queued" || status === "running" || status === "waiting_input";
}

export function SmartAddWordsModal({
  isOpen, targetLanguage, nativeLanguage, batch, onClose, onCompleted,
}: Props) {
  const [tab, setTab] = useState<Tab>("single");
  const [singleInput, setSingleInput] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [inputLanguage, setInputLanguage] = useState<InputLanguage>("auto");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<SmartJobSnapshot | null>(null);
  const [answerSent, setAnswerSent] = useState(false);
  const completionHandled = useRef<string | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState("");

  const currentInput = tab === "single" ? singleInput : topicInput;
  const setCurrentInput = tab === "single" ? setSingleInput : setTopicInput;
  const jobActive = isRunning(job?.status);
  const clarification = answerSent ? "" : job?.status === "waiting_input" ? job.clarification || "" : "";
  const dictationContext = useMemo(
    () => `Learner studies ${targetLanguage}; native language is ${nativeLanguage}. ${tab === "single" ? "Dictate one word or phrase." : "Dictate a vocabulary topic or a request for a complete set."}`,
    [nativeLanguage, tab, targetLanguage],
  );
  const appendDictation = useCallback((text: string) => {
    setCurrentInput((previous) => previous.trim() ? `${previous.trim()} ${text}` : text);
  }, [setCurrentInput]);
  const dictation = useGeminiDictation(isOpen, dictationContext, appendDictation);
  const appendClarificationDictation = useCallback((text: string) => {
    setClarificationAnswer((previous) => previous.trim() ? `${previous.trim()} ${text}` : text);
  }, []);
  const clarificationDictation = useGeminiDictation(
    isOpen && Boolean(clarification),
    `Answer the AI's clarification question for a vocabulary request. The question is: ${clarification}`,
    appendClarificationDictation,
  );

  // Reattach to an unfinished server-side job when the modal is opened again.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/dictionary/smart/jobs", { headers: await getAiHeaders() });
        if (!response.ok) return;
        const data = await response.json() as { jobs?: SmartJobSnapshot[] };
        const candidate = (data.jobs ?? []).find((item) => batch?.id ? item.batch_id === batch.id : true);
        if (cancelled || !candidate) return;
        setJobId(candidate.id);
        setJob(candidate);
        setAnswerSent(false);
        setTab(candidate.mode);
        if (candidate.mode === "single") setSingleInput(candidate.request);
        else setTopicInput(candidate.request);
      } catch {
        // Reconnecting is best-effort; the user can still submit a new job.
      }
    })();
    return () => { cancelled = true; };
  }, [batch?.id, isOpen]);

  // Polling only reads progress. Closing the modal stops polling but never
  // cancels the Workflow that owns the task.
  useEffect(() => {
    if (!isOpen || !jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await fetch(`/api/dictionary/smart/jobs/${jobId}`, { headers: await getAiHeaders() });
        if (!response.ok) return;
        const data = await response.json() as { job?: SmartJobSnapshot };
        if (cancelled || !data.job) return;
        setJob(data.job);
        if (data.job.status !== "waiting_input") setAnswerSent(false);
        if (data.job.status === "completed" && completionHandled.current !== data.job.id) {
          completionHandled.current = data.job.id;
          if (data.job.result) onCompleted(data.job.result);
          setJobId(null);
          onClose();
          return;
        }
      } catch {
        // A transient network failure must not stop the server-side workflow.
      } finally {
        if (!cancelled) timer = setTimeout(() => void poll(), 1800);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isOpen, jobId, onClose, onCompleted]);

  if (!isOpen) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const request = currentInput.trim();
    if (!request || busy || jobActive) return;
    setBusy(true);
    setError("");
    setStatus("Ставлю задачу в фоновую очередь…");
    try {
      const response = await fetch("/api/dictionary/smart", {
        method: "POST",
        headers: await getAiHeaders(),
        body: JSON.stringify({ mode: tab, request, inputLanguage, targetLanguage, nativeLanguage, batchId: batch?.id ?? null }),
      });
      const data = await response.json() as { jobId?: string; error?: string };
      if (!response.ok || !data.jobId) throw new Error(data.error || "Не удалось поставить задачу в очередь.");
      setJobId(data.jobId);
      setJob({
        id: data.jobId, status: "queued", mode: tab, request, batch_id: batch?.id ?? null,
        batch_title: batch?.title ?? "", current_action: "Задача поставлена в очередь…", rounds_completed: 0,
        total_added: 0, last_words: [], clarification: null, error: null, result: null,
      });
      setStatus("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось добавить слова.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function submitClarification(event: React.FormEvent) {
    event.preventDefault();
    const answer = clarificationAnswer.trim();
    if (!jobId || !answer || busy) {
      if (!answer) setError("Напишите или наговорите ответ на вопрос ИИ.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/dictionary/smart/jobs/${jobId}`, {
        method: "POST", headers: await getAiHeaders(), body: JSON.stringify({ answer }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось передать ответ ИИ.");
      setAnswerSent(true);
      setClarificationAnswer("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось передать ответ ИИ.");
    } finally {
      setBusy(false);
    }
  }

  const title = batch ? `Добавить в «${batch.title}»` : "Добавить в словарь";
  const micLabel = dictation.busy
    ? dictation.phase === "recording" ? `Идёт запись · ${dictation.seconds} с` : "ИИ распознаёт…"
    : "Наговорить голосом";
  const progressWords = job?.last_words ?? [];

  return (
    <div className="modal-backdrop smart-add-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !dictation.busy && !clarificationDictation.busy) onClose();
    }}>
      <section className="modal-card smart-add-modal" role="dialog" aria-modal="true" aria-labelledby="smart-add-title">
        <div className="smart-add-head">
          <div>
            <span className="eyebrow">Словарь</span>
            <h2 id="smart-add-title">{title}</h2>
            <p>Добавьте слово сами или поручите ИИ собрать целую пачку.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose} disabled={dictation.busy || clarificationDictation.busy}><X size={18} /></button>
        </div>

        <div className="smart-add-tabs" role="tablist" aria-label="Способ добавления">
          <button type="button" role="tab" aria-selected={tab === "single"} className={tab === "single" ? "active" : ""} onClick={() => { setTab("single"); setError(""); }} disabled={jobActive}><Plus size={15} /> Одно слово</button>
          <button type="button" role="tab" aria-selected={tab === "topic"} className={tab === "topic" ? "active" : ""} onClick={() => { setTab("topic"); setError(""); }} disabled={jobActive}><ListPlus size={15} /> Умная пачка</button>
        </div>

        <form onSubmit={submit}>
          <label className="smart-add-label" htmlFor="smart-add-input">{tab === "single" ? "Какое слово добавить?" : "Что собрать?"}</label>
          <div className="smart-add-input-wrap">
            <textarea id="smart-add-input" value={currentInput} onChange={(event) => setCurrentInput(event.target.value)} placeholder={tab === "single" ? "Например: die Reise или путешествие" : "Например: все времена года или неправильные глаголы A1"} rows={tab === "single" ? 2 : 3} autoFocus disabled={jobActive || dictation.busy || Boolean(clarification)} />
            <button type="button" className={`smart-add-mic${dictation.busy ? " recording" : ""}`} onClick={() => void dictation.toggle()} disabled={jobActive || !dictation.supported} aria-label={micLabel} title={dictation.supported ? micLabel : "Микрофон недоступен на этом устройстве"}><Mic size={18} /></button>
          </div>

          <div className="smart-add-language-row" role="group" aria-label="Язык ввода">
            <span>Язык определит ИИ</span>
            {(["auto", "target", "native"] as InputLanguage[]).map((option) => <button key={option} type="button" className={inputLanguage === option ? "active" : ""} onClick={() => setInputLanguage(option)} disabled={jobActive}>{option === "auto" ? "Авто" : option === "target" ? languageName[targetLanguage] || targetLanguage : languageName[nativeLanguage] || nativeLanguage}</button>)}
          </div>

          {tab === "topic" && <div className="smart-add-suggestions" aria-label="Примеры запросов">{["все цвета", "времена года", "неправильные глаголы A1", "слова из песни"].map((suggestion) => <button key={suggestion} type="button" onClick={() => setTopicInput(suggestion)} disabled={jobActive || dictation.busy}>{suggestion}</button>)}</div>}
          {(dictation.error || error || (job?.status === "failed" ? job.error : "")) && <p className="smart-add-error" role="alert">{dictation.error || error || job?.error}</p>}
          {status && <p className="smart-add-status" aria-live="polite"><LoaderCircle size={15} className="spin" />{status}</p>}

          <button type="submit" className="primary-btn smart-add-submit" disabled={busy || jobActive || dictation.busy || !currentInput.trim()}>{busy || jobActive ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}{jobActive ? "Задача уже выполняется" : busy ? "Ставлю в очередь…" : tab === "single" ? "Добавить слово" : "Собрать пачку"}</button>
          {tab === "topic" && <small className="smart-add-footnote">Задача сохраняется на сервере после каждого раунда. Окно можно закрыть — сбор продолжится в фоне.</small>}
        </form>
      </section>

      {jobActive && !clarification && <div className="modal-backdrop smart-progress-backdrop" role="presentation">
        <section className="modal-card smart-progress-modal" role="dialog" aria-modal="true" aria-labelledby="smart-progress-title">
          <div className="smart-question-head"><span className="smart-question-kicker"><Sparkles size={14} /> Фоновая задача</span><button type="button" className="icon-btn" aria-label="Закрыть окно прогресса" onClick={onClose}><X size={17} /></button></div>
          <h3 id="smart-progress-title">ИИ работает независимо от окна</h3>
          <p className="smart-progress-action" aria-live="polite"><LoaderCircle size={16} className="spin" />{job?.current_action || "Подготавливаю задачу…"}</p>
          <div className="smart-progress-meta"><span>Раундов: {job?.rounds_completed ?? 0}</span><span>Добавлено: {job?.total_added ?? 0}</span></div>
          {progressWords.length > 0 && <div className="smart-progress-words"><span>Последние слова</span><div>{progressWords.slice(0, 12).map((word) => <span className="smart-progress-word" key={word}>{word}</span>)}</div></div>}
          <p className="smart-add-footnote">Можно закрыть это окно или вкладку. Слова уже записываются в пачку по мере готовности.</p>
        </section>
      </div>}

      {clarification && <div className="modal-backdrop smart-question-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !clarificationDictation.busy) onClose(); }}>
        <section className="modal-card smart-question-modal" role="dialog" aria-modal="true" aria-labelledby="smart-question-title">
          <div className="smart-question-head"><span className="smart-question-kicker"><Sparkles size={14} /> Уточнение от ИИ</span><button type="button" className="icon-btn" aria-label="Закрыть окно уточнения" onClick={onClose} disabled={busy || clarificationDictation.busy}><X size={17} /></button></div>
          <h3 id="smart-question-title">Уточним запрос</h3>
          <p className="smart-question-text">{clarification}</p>
          <form onSubmit={submitClarification}>
            <label className="smart-add-label" htmlFor="smart-question-answer">Ваш ответ</label>
            <div className="smart-question-input-wrap">
              <textarea id="smart-question-answer" value={clarificationAnswer} onChange={(event) => { setClarificationAnswer(event.target.value); setError(""); }} placeholder="Напишите ответ или наговорите его" rows={3} autoFocus disabled={busy || clarificationDictation.busy} />
              <button type="button" className={`smart-add-mic${clarificationDictation.busy ? " recording" : ""}`} onClick={() => void clarificationDictation.toggle()} disabled={busy || !clarificationDictation.supported} aria-label={clarificationDictation.busy ? "ИИ распознаёт ответ…" : "Наговорить ответ"} title={clarificationDictation.supported ? "Наговорить ответ" : "Микрофон недоступен на этом устройстве"}><Mic size={18} /></button>
            </div>
            {(clarificationDictation.error || error) && <p className="smart-add-error" role="alert">{clarificationDictation.error || error}</p>}
            {clarificationDictation.busy && <p className="smart-add-status" aria-live="polite"><LoaderCircle size={15} className="spin" />{clarificationDictation.phase === "recording" ? `Идёт запись · ${clarificationDictation.seconds} с` : "ИИ распознаёт ответ…"}</p>}
            <button type="submit" className="primary-btn smart-add-submit" disabled={busy || clarificationDictation.busy || !clarificationAnswer.trim()}>{busy ? <LoaderCircle size={17} className="spin" /> : <CheckCircle2 size={17} />}{busy ? "Передаю ответ…" : "Продолжить"}</button>
          </form>
        </section>
      </div>}
    </div>
  );
}
