"use client";

import { useState, useEffect, useRef } from "react";
import { ChevronDown, Plus, ChevronLeft, ChevronRight, Zap } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { normalizeToken } from "@/lib/selector/text";
import { subscribeTTS, getTTSState, TTSState, toggleAutoNext, speak } from "@/lib/tts";
import type { AiAnalysis, Flashcard } from "@/lib/types";

type Tab = "word" | "phrase" | "sentence";

type Props = {
  selection: { token: string; phraseText: string; sentence: string };
  analysis: AiAnalysis | null;
  isLoading: boolean;
  lang: string;
  onClose: () => void;
  onOpenWordModal: () => void;
  onAddCard: (type: Flashcard["type"]) => void;
  onWordTap: (word: string) => void;
  onNext?: (level: Tab) => void;
  onPrev?: (level: Tab) => void;
};

export function AiPanel({ selection, analysis, isLoading, lang, onClose, onOpenWordModal, onAddCard, onWordTap, onNext, onPrev }: Props) {
  const [tab, setTab] = useState<Tab>("word");
  const [tts, setTts] = useState<TTSState>(getTTSState());
  const lastSentenceRef = useRef(selection.sentence);
  const wasPlayingRef = useRef(false);

  useEffect(() => {
    return subscribeTTS((s) => setTts(s));
  }, []);

  // Logic to auto-advance to next sentence
  useEffect(() => {
    if (tts.autoNext && !tts.repeat && tts.status === "idle" && wasPlayingRef.current) {
      if (tab === "sentence" && onNext) {
        onNext("sentence");
      }
    }
    wasPlayingRef.current = tts.status === "playing";
  }, [tts.status, tts.autoNext, tts.repeat, tab, onNext]);

  // Logic to auto-play when sentence changes due to auto-advance
  useEffect(() => {
    if (tts.autoNext && selection.sentence !== lastSentenceRef.current) {
      speak(selection.sentence, lang);
    }
    lastSentenceRef.current = selection.sentence;
  }, [selection.sentence, tts.autoNext, lang]);

  const tabs: { id: Tab; label: string }[] = [
    { id: "word", label: "Слово" },
    { id: "phrase", label: "Фраза" },
    { id: "sentence", label: "Предложение" },
  ];

  return (
    <aside className="ai-panel">
      <div className="panel-drag-area">
        <div className="panel-handle-bar" />
        <div className="panel-close-row">
          <span className="panel-selected-word">{selection.token}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button 
              className="icon-btn" 
              style={{ 
                width: 34, height: 34, 
                color: tts.autoNext ? 'var(--accent)' : 'inherit',
                opacity: tts.autoNext ? 1 : 0.6
              }} 
              onClick={toggleAutoNext}
              type="button" 
              aria-label="Автопереход"
            >
              <Zap size={16} fill={tts.autoNext ? "currentColor" : "none"} />
            </button>
            {onPrev && (
              <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => onPrev(tab)} type="button" aria-label="Предыдущее">
                <ChevronLeft size={18} />
              </button>
            )}
            {onNext && (
              <button className="icon-btn" style={{ width: 34, height: 34 }} onClick={() => onNext(tab)} type="button" aria-label="Следующее">
                <ChevronRight size={18} />
              </button>
            )}
            <button className="icon-btn" style={{ width: 34, height: 34, marginLeft: 4 }} onClick={onClose} type="button" aria-label="Закрыть">
              <ChevronDown size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="panel-tabs">
        {tabs.map(({ id, label }) => (
          <button key={id} type="button" className={`panel-tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <div className="panel-tab-content">
        {tab === "word" && (
          <div className="tab-body">
            <div className="tab-row-main">
              <div>
                <span className="tab-main-word">{analysis?.word.text ?? selection.token}</span>
                {analysis?.word.partOfSpeech && (
                  <span className="tab-pos">{analysis.word.partOfSpeech}{analysis.word.gender ? ` · ${analysis.word.gender}` : ""}</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <SpeakButton key={analysis?.word.lemma ?? selection.token} text={analysis?.word.lemma ?? selection.token} lang={lang} />
                <button className="mini-btn" type="button" disabled={!analysis} onClick={onOpenWordModal}>подробнее</button>
              </div>
            </div>
            {analysis ? (
              <>
                <p className="tab-translation">{analysis.word.translation}</p>
                <p className="tab-note">{analysis.word.explanation}</p>
              </>
            ) : (
              <>{isLoading && <><div className="shimmer-line" /><div className="shimmer-line medium" /></>}</>
            )}
          </div>
        )}

        {tab === "phrase" && (
          <div className="tab-body">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <ClickableText text={selection.phraseText} lang={lang} onWordTap={onWordTap} className="tab-phrase-text" />
              <SpeakButton key={selection.phraseText} text={selection.phraseText} lang={lang} />
            </div>
            {analysis ? (
              <>
                <p className="tab-translation">{analysis.phrase.translation}</p>
                <p className="tab-note">{analysis.phrase.explanation}</p>
              </>
            ) : (
              <>{isLoading && <><div className="shimmer-line" style={{ marginTop: 8 }} /><div className="shimmer-line medium" /></>}</>
            )}
          </div>
        )}

        {tab === "sentence" && (
          <div className="tab-body">
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <ClickableText text={selection.sentence} lang={lang} onWordTap={onWordTap} className="tab-sentence-text" />
              <SpeakButton key={selection.sentence} text={selection.sentence} lang={lang} />
            </div>
            {analysis ? (
              <>
                <p className="tab-translation">{analysis.sentence.translation}</p>
                <p className="tab-note">{analysis.sentence.grammarNote}</p>
              </>
            ) : (
              <>{isLoading && <><div className="shimmer-line" style={{ marginTop: 8 }} /><div className="shimmer-line medium" /><div className="shimmer-line short" /></>}</>
            )}
          </div>
        )}
      </div>

      <button
        className="primary-btn"
        type="button"
        disabled={!analysis}
        onClick={() => onAddCard(tab === "word" ? "word" : tab === "phrase" ? "phrase" : "sentence")}
        style={{ marginTop: 12 }}
      >
        <Plus size={18} />
        Добавить карточку
      </button>
    </aside>
  );
}

/** Renders text as clickable word tokens */
function ClickableText({ text, lang, onWordTap, className }: { text: string; lang: string; onWordTap: (w: string) => void; className?: string }) {
  const [ttsState, setTtsState] = useState<TTSState | null>(null);

  useEffect(() => {
    let unmounted = false;
    let localState: TTSState | null = null;
    let rAFRef: number | null = null;

    const unsubscribe = subscribeTTS((newState) => {
      localState = newState;
      if (!unmounted) setTtsState(newState);
    });

    const tick = () => {
      if (!unmounted && localState && localState.status === "playing") {
        setTtsState(getTTSState());
      }
      rAFRef = requestAnimationFrame(tick);
    };
    rAFRef = requestAnimationFrame(tick);

    return () => {
      unmounted = true;
      unsubscribe();
      if (rAFRef) cancelAnimationFrame(rAFRef);
    };
  }, []);

  const activeCharIndex = (ttsState && (ttsState.status === "playing" || ttsState.status === "paused") && ttsState.text === text) 
    ? ttsState.activeCharIndex 
    : undefined;

  const words = text.split(/(\s+)/);
  let currentOffset = 0;

  return (
    <span className={className} style={{ flex: 1 }}>
      {words.map((chunk, i) => {
        const startIndex = currentOffset;
        const endIndex = currentOffset + chunk.length;
        currentOffset = endIndex;

        const norm = normalizeToken(chunk);
        
        let isSpoken = false;
        if (activeCharIndex !== undefined && activeCharIndex >= 0) {
           if (activeCharIndex >= startIndex) {
               isSpoken = true;
           }
        }

        if (!norm) return <span key={i} className={isSpoken ? "karaoke-spoken" : ""}>{chunk}</span>;
        
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            className={`panel-clickable-word ${isSpoken ? "karaoke-spoken" : ""}`}
            onClick={() => onWordTap(chunk)}
            onKeyDown={(e) => { if (e.key === "Enter") onWordTap(chunk); }}
          >
            {chunk}
          </span>
        );
      })}
    </span>
  );
}
