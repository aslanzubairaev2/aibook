"use client";

import { Fragment, useEffect, useState } from "react";
import { X, Loader2, AlertTriangle, Globe } from "lucide-react";
import { SpeakButton } from "@/components/ui/SpeakButton";
import { fetchGrammar } from "@/lib/ai/grammar";
import { makeGrammarCacheKey } from "@/lib/ai/cacheKeys";
import { getLocalGrammar, saveLocalGrammar } from "@/lib/db/local";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import type { GrammarMatrix, GrammarTable, PosTag } from "@/lib/types";

type Props = {
  word: string;
  lemma?: string;
  posTag: PosTag;
  defaultLang: string;
  nativeLang: string;
  onClose: () => void;
};

export const POS_GRAMMAR_LABEL: Record<PosTag, string> = {
  verb: "Спряжение глагола",
  noun: "Склонение существительного",
  adjective: "Степени сравнения",
  adverb: "Грамматические формы",
  pronoun: "Склонение местоимения",
  numeral: "Формы числительного",
  other: "Грамматические формы",
};

const GENDER_META: Record<"m" | "f" | "n" | "pl", { label: string }> = {
  m: { label: "der" },
  f: { label: "die" },
  n: { label: "das" },
  pl: { label: "die · мн." },
};

function langName(code: string) {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.nameNative ?? code.toUpperCase();
}

// One conjugation/declension line: target phrase on top, native gloss below.
function GrammarLine({ form, native, lang }: { form: string; native?: string; lang: string }) {
  return (
    <div className="petrov-line">
      <div className="petrov-text">
        <div className="petrov-form">{form}</div>
        {native && <div className="petrov-native">{native}</div>}
      </div>
      <SpeakButton text={form} lang={lang} size={13} />
    </div>
  );
}

// Coerce whatever the model put in a matrix cell into a clean person list.
// The AI does not always nest exactly as asked, so we defend against strings,
// alternate key names, and {persons:[…]} wrappers rather than crashing.
function toRows(cell: unknown): { form: string; native: string }[] {
  if (Array.isArray(cell)) {
    return cell
      .map((p) => {
        if (typeof p === "string") return { form: p, native: "" };
        if (p && typeof p === "object") {
          const o = p as Record<string, unknown>;
          return {
            form: String(o.form ?? o.target ?? o.text ?? ""),
            native: String(o.native ?? o.translation ?? o.ru ?? ""),
          };
        }
        return { form: "", native: "" };
      })
      .filter((r) => r.form);
  }
  if (cell && typeof cell === "object") {
    const o = cell as Record<string, unknown>;
    const inner = o.persons ?? o.rows ?? o.cells ?? o.forms;
    if (Array.isArray(inner)) return toRows(inner);
  }
  return [];
}

// Petrov-style verb grid: tenses (rows) × polarities (columns), horizontally scrollable.
function PetrovMatrix({ matrix, lang }: { matrix: GrammarMatrix; lang: string }) {
  const cols = Array.isArray(matrix.colLabels) ? matrix.colLabels : [];
  const rows = Array.isArray(matrix.rowLabels) ? matrix.rowLabels : [];
  const rawCells: unknown[] = Array.isArray(matrix.cells) ? (matrix.cells as unknown[]) : [];
  if (!rows.length || !cols.length) return null;
  return (
    <div className="petrov-scroll">
      <div className="petrov-grid" style={{ gridTemplateColumns: `72px repeat(${cols.length}, minmax(210px, 1fr))` }}>
        <div className="petrov-corner" />
        {cols.map((c, ci) => <div key={ci} className="petrov-col-head">{c}</div>)}
        {rows.map((r, ri) => {
          const row: unknown[] = Array.isArray(rawCells[ri]) ? (rawCells[ri] as unknown[]) : [];
          return (
            <Fragment key={ri}>
              <div className="petrov-row-head">{r}</div>
              {cols.map((_, ci) => (
                <div key={ci} className="petrov-cell">
                  {toRows(row[ci]).map((p, pi) => (
                    <GrammarLine key={pi} form={p.form} native={p.native} lang={lang} />
                  ))}
                </div>
              ))}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

export function GrammarModal({ word, lemma, posTag, defaultLang, nativeLang, onClose }: Props) {
  const [lang, setLang] = useState(defaultLang);
  const [detail, setDetail] = useState<"brief" | "full">("brief");
  const [langOpen, setLangOpen] = useState(false);
  const [tables, setTables] = useState<Record<string, GrammarTable>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseText = lemma || word;
  const current = tables[`${lang}:${detail}`] ?? null;
  const gender = current?.gender || null;
  const isDeclension = current?.kind === "declension";
  const showLangChips = langOpen || !!current?.languageWarning;

  async function load(targetDetail: "brief" | "full", targetLang: string) {
    const mapKey = `${targetLang}:${targetDetail}`;
    setDetail(targetDetail);
    setLang(targetLang);
    setLangOpen(false);
    setError(null);

    if (tables[mapKey]) return;

    const cacheKey = makeGrammarCacheKey(baseText, targetDetail, targetLang, nativeLang);
    const cached = getLocalGrammar(cacheKey);
    if (cached) {
      setTables((prev) => ({ ...prev, [mapKey]: cached }));
      return;
    }

    setLoading(true);
    try {
      const table = await fetchGrammar({
        word,
        lemma,
        posTag,
        targetLanguage: targetLang,
        nativeLanguage: nativeLang,
        detail: targetDetail,
      });
      saveLocalGrammar(cacheKey, table);
      setTables((prev) => ({ ...prev, [mapKey]: table }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось загрузить грамматику");
    } finally {
      setLoading(false);
    }
  }

  // Load the brief table as soon as the modal opens.
  useEffect(() => {
    void load(detail, lang);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop grammar-modal-backdrop" onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <section className="grammar-modal" role="dialog" aria-modal aria-label={POS_GRAMMAR_LABEL[posTag]} onClick={(e) => e.stopPropagation()}>
        <div className="grammar-modal-bar">
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
          <div className="grammar-modal-title">
            <span className="grammar-modal-eyebrow">{POS_GRAMMAR_LABEL[posTag]}</span>
            <strong>{baseText}</strong>
          </div>
          <SpeakButton text={baseText} lang={lang} size={18} />
        </div>

        <div className="grammar-body">
          <div className="grammar-controls">
            <div className="grammar-segment" role="tablist" aria-label="Объём таблицы">
              <button type="button" role="tab" aria-selected={detail === "brief"} className={`grammar-segment-btn ${detail === "brief" ? "active" : ""}`} disabled={loading} onClick={() => { if (detail !== "brief") void load("brief", lang); }}>Кратко</button>
              <button type="button" role="tab" aria-selected={detail === "full"} className={`grammar-segment-btn ${detail === "full" ? "active" : ""}`} disabled={loading} onClick={() => { if (detail !== "full") void load("full", lang); }}>Полная</button>
            </div>

            {showLangChips ? (
              <div className="grammar-lang-chips">
                {SUPPORTED_LANGUAGES.filter((l) => l.code !== nativeLang).map((l) => (
                  <button key={l.code} type="button" className={`grammar-lang-chip ${lang === l.code ? "active" : ""}`} onClick={() => { if (l.code !== lang) void load(detail, l.code); else setLangOpen(false); }}>{l.nameNative}</button>
                ))}
              </div>
            ) : (
              <button type="button" className="grammar-lang-globe" onClick={() => setLangOpen(true)} aria-label="Сменить язык" title="Сменить язык">
                <Globe size={14} />
                <span>{langName(lang)}</span>
              </button>
            )}
          </div>

          {gender && <div className={`grammar-gender-badge g-${gender}`}>{GENDER_META[gender].label}</div>}

          {current?.languageWarning && (
            <div className="grammar-warning">
              <AlertTriangle size={15} />
              <span>{current.languageWarning}</span>
            </div>
          )}

          {loading && (
            <div className="grammar-loading">
              <Loader2 size={18} className="animate-spin" />
              <span>Строю таблицу…</span>
            </div>
          )}

          {error && !loading && (
            <div className="grammar-error">
              <span>{error}</span>
              <button type="button" className="grammar-retry" onClick={() => void load(detail, lang)}>Повторить</button>
            </div>
          )}

          {current && !loading && (
            current.matrix ? (
              <PetrovMatrix matrix={current.matrix} lang={lang} />
            ) : (
              (current.sections ?? []).map((section, si) => {
                const isVerb = current.partOfSpeech === "verb";
                return (
                  <div key={si} className="grammar-section">
                    <div className="grammar-section-head">
                      <span className="grammar-section-title">{section.title}</span>
                      {section.caption && <span className="grammar-section-caption">{section.caption}</span>}
                    </div>
                    <div className="grammar-cells">
                      {section.cells.map((cell, ci) => {
                        const target = cell.pronoun ? `${cell.pronoun} ${cell.form}` : cell.form;
                        if (isVerb) {
                          return <GrammarLine key={ci} form={target} native={cell.label} lang={lang} />;
                        }
                        const pronounCls = isDeclension && gender ? `grammar-cell-pronoun art-${gender}` : "grammar-cell-pronoun";
                        return (
                          <div key={ci} className="grammar-cell">
                            <span className="grammar-cell-label">{cell.label}</span>
                            <span className="grammar-cell-form">
                              {cell.pronoun && <span className={pronounCls}>{cell.pronoun} </span>}
                              <b>{cell.form}</b>
                            </span>
                            <SpeakButton text={target} lang={lang} size={14} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )
          )}
        </div>
      </section>
    </div>
  );
}
