"use client";

import { useCallback, useMemo, useState } from "react";
import { ListPlus, LoaderCircle, Mic, Plus, Sparkles, X } from "lucide-react";
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

const languageName: Record<string, string> = {
  de: "немецкий", en: "английский", ru: "русский", es: "испанский", fr: "французский",
};

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
  const [clarification, setClarification] = useState("");

  const currentInput = tab === "single" ? singleInput : topicInput;
  const setCurrentInput = tab === "single" ? setSingleInput : setTopicInput;
  const dictationContext = useMemo(
    () => `Learner studies ${targetLanguage}; native language is ${nativeLanguage}. ${tab === "single" ? "Dictate one word or phrase." : "Dictate a vocabulary topic or a request for a complete set."}`,
    [nativeLanguage, tab, targetLanguage],
  );
  const appendDictation = useCallback((text: string) => {
    setCurrentInput((previous) => previous.trim() ? `${previous.trim()} ${text}` : text);
  }, [setCurrentInput]);
  const dictation = useGeminiDictation(isOpen, dictationContext, appendDictation);

  if (!isOpen) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const request = currentInput.trim();
    if (!request || busy) return;
    setBusy(true);
    setError("");
    setClarification("");
    setStatus(tab === "single" ? "ИИ разбирает слово…" : "ИИ собирает словарь по теме…");
    try {
      const headers = await getAiHeaders();
      const response = await fetch("/api/dictionary/smart", {
        method: "POST",
        headers,
        body: JSON.stringify({
          mode: tab,
          request,
          inputLanguage,
          targetLanguage,
          nativeLanguage,
          batchId: batch?.id ?? null,
        }),
      });
      const data = await response.json() as Partial<SmartAddResult> & { error?: string; clarification?: string };
      if (!response.ok) throw new Error(data.error || "Не удалось добавить слова.");
      if (data.clarification) {
        setClarification(data.clarification);
        setStatus("");
        return;
      }
      if (!data.batchId || !data.batchTitle) throw new Error("ИИ не вернул созданную пачку.");
      onCompleted(data as SmartAddResult);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось добавить слова.");
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  const title = batch ? `Добавить в «${batch.title}»` : "Добавить в словарь";
  const micLabel = dictation.busy
    ? dictation.phase === "recording" ? `Идёт запись · ${dictation.seconds} с` : "ИИ распознаёт…"
    : "Наговорить голосом";

  return (
    <div className="modal-backdrop smart-add-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy && !dictation.busy) onClose();
    }}>
      <section className="modal-card smart-add-modal" role="dialog" aria-modal="true" aria-labelledby="smart-add-title">
        <div className="smart-add-head">
          <div>
            <span className="eyebrow">Словарь</span>
            <h2 id="smart-add-title">{title}</h2>
            <p>Добавьте слово сами или поручите ИИ собрать целую пачку.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose} disabled={busy || dictation.busy}>
            <X size={18} />
          </button>
        </div>

        <div className="smart-add-tabs" role="tablist" aria-label="Способ добавления">
          <button type="button" role="tab" aria-selected={tab === "single"} className={tab === "single" ? "active" : ""} onClick={() => { setTab("single"); setError(""); }}>
            <Plus size={15} /> Одно слово
          </button>
          <button type="button" role="tab" aria-selected={tab === "topic"} className={tab === "topic" ? "active" : ""} onClick={() => { setTab("topic"); setError(""); }}>
            <ListPlus size={15} /> Умная пачка
          </button>
        </div>

        <form onSubmit={submit}>
          <label className="smart-add-label" htmlFor="smart-add-input">
            {tab === "single" ? "Какое слово добавить?" : "Что собрать?"}
          </label>
          <div className="smart-add-input-wrap">
            <textarea
              id="smart-add-input"
              value={currentInput}
              onChange={(event) => setCurrentInput(event.target.value)}
              placeholder={tab === "single" ? "Например: die Reise или путешествие" : "Например: все времена года или неправильные глаголы A1"}
              rows={tab === "single" ? 2 : 3}
              autoFocus
              disabled={busy || dictation.busy}
            />
            <button type="button" className={`smart-add-mic${dictation.busy ? " recording" : ""}`} onClick={() => void dictation.toggle()} disabled={busy || !dictation.supported} aria-label={micLabel} title={dictation.supported ? micLabel : "Микрофон недоступен на этом устройстве"}>
              <Mic size={18} />
            </button>
          </div>

          <div className="smart-add-language-row" role="group" aria-label="Язык ввода">
            <span>Язык определит ИИ</span>
            {(["auto", "target", "native"] as InputLanguage[]).map((option) => (
              <button key={option} type="button" className={inputLanguage === option ? "active" : ""} onClick={() => setInputLanguage(option)} disabled={busy}>
                {option === "auto" ? "Авто" : option === "target" ? languageName[targetLanguage] || targetLanguage : languageName[nativeLanguage] || nativeLanguage}
              </button>
            ))}
          </div>

          {tab === "topic" && (
            <div className="smart-add-suggestions" aria-label="Примеры запросов">
              {["все цвета", "времена года", "неправильные глаголы A1", "слова из песни"].map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => setTopicInput(suggestion)} disabled={busy || dictation.busy}>{suggestion}</button>
              ))}
            </div>
          )}

          {(dictation.error || error) && <p className="smart-add-error" role="alert">{dictation.error || error}</p>}
          {clarification && (
            <div className="smart-add-clarification" role="status">
              <strong>Нужно уточнение</strong>
              <p>{clarification}</p>
            </div>
          )}
          {status && <p className="smart-add-status" aria-live="polite"><LoaderCircle size={15} className="spin" />{status}</p>}

          <button type="submit" className="primary-btn smart-add-submit" disabled={busy || dictation.busy || !currentInput.trim()}>
            {busy ? <LoaderCircle size={17} className="spin" /> : <Sparkles size={17} />}
            {busy ? "ИИ работает…" : tab === "single" ? "Добавить слово" : "Собрать пачку"}
          </button>
          {tab === "topic" && <small className="smart-add-footnote">Большие списки собираются несколькими AI-раундами, пока модель не закончит тему.</small>}
        </form>
      </section>
    </div>
  );
}
