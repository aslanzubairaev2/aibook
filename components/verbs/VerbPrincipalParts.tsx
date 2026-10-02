"use client";

import { useEffect, useState } from "react";
import { fetchVerbForms, peekVerbForms } from "@/lib/ai/verbFormsClient";
import { splitCardBack } from "@/lib/cards";
import {
  extractVerbFormsFromDetails,
  looksLikeGermanInfinitive,
  GERMAN_VERB_CLASS_HINT,
  GERMAN_VERB_CLASS_LABEL,
  hasCompleteGermanVerbForms,
  summarizeGermanVerb,
  type GermanVerbSummary,
} from "@/lib/verbForms";

/**
 * Präteritum, Perfekt and the verb's class for a German infinitive. Uses the
 * forms the caller already has when they are complete; otherwise asks the
 * forms endpoint once and caches the answer. Returns null for anything that is
 * not a German verb, so callers can render it unconditionally.
 */
export function useGermanVerbSummary(
  infinitive: string | undefined,
  lang: string,
  nativeLang: string,
  known?: Record<string, string | undefined>,
): { summary: GermanVerbSummary | null; loading: boolean } {
  const lemma = (infinitive ?? "").trim();
  const enabled = lang === "de" && Boolean(lemma);
  const seeded = enabled && hasCompleteGermanVerbForms(known) ? known! : null;
  const [fetched, setFetched] = useState<{ lemma: string; forms: Record<string, string> | null } | null>(null);

  useEffect(() => {
    if (!enabled || seeded) return;
    let alive = true;
    void fetchVerbForms(lemma, lang, nativeLang).then((forms) => {
      if (alive) setFetched({ lemma, forms });
    });
    return () => { alive = false; };
  }, [enabled, seeded, lemma, lang, nativeLang]);

  if (!enabled) return { summary: null, loading: false };
  const forms = seeded
    ?? (fetched?.lemma === lemma ? fetched.forms : peekVerbForms(lemma, lang) ?? null);
  const loading = !seeded && fetched?.lemma !== lemma && peekVerbForms(lemma, lang) === undefined;
  return { summary: forms ? summarizeGermanVerb(lemma, forms) : null, loading };
}

/** «сильный» chip with the hint as a tooltip; «отделяемый» joins it when it applies. */
export function VerbClassChips({ summary, className = "word-meta-chip" }: { summary: GermanVerbSummary; className?: string }) {
  return (
    <>
      <span className={`${className} verb-class verb-class-${summary.verbClass}`} title={GERMAN_VERB_CLASS_HINT[summary.verbClass]}>
        {GERMAN_VERB_CLASS_LABEL[summary.verbClass]}
      </span>
      {summary.separable && <span className={`${className} verb-class`} title="Приставка отделяется: ich kaufe ein">отделяемый</span>}
    </>
  );
}

/** Compact line for a flashcard back: «книжн. backte · разг. hat gebacken · сильный». */
export function CardVerbForms({ summary }: { summary: GermanVerbSummary }) {
  return (
    <div className="card-verb-forms">
      <span title="Präteritum — книжное прошедшее"><i>книжн.</i> <b>{summary.praeteritum}</b></span>
      <span title="Perfekt — разговорное прошедшее"><i>разг.</i> <b>{summary.perfekt}</b></span>
      <VerbClassChips summary={summary} className="card-verb-chip" />
    </div>
  );
}

/**
 * Verb line for a flashcard back. Works on every existing card without a data
 * migration: the forms come from the card's own dictionary row, then from the
 * «Präteritum: … · Partizip II: …» line a dictionary-made back already holds,
 * and only then from one cached AI lookup. `details` is the rest of the back
 * with those form labels removed, so nothing is printed twice.
 */
export function useCardVerbSummary(
  card: { front: string; back: string; type: string } | undefined,
  lang: string,
  nativeLang: string,
  dictionary?: { partOfSpeech: string; lemma: string; forms: Record<string, string> },
): { summary: GermanVerbSummary | null; details: string } {
  const { details } = splitCardBack(card?.back ?? "");
  const parsed = extractVerbFormsFromDetails(details);
  const front = (card?.front ?? "").trim();
  const dictVerb = dictionary ? /глагол|verb/iu.test(dictionary.partOfSpeech) : undefined;
  const candidate = card?.type === "word" && lang === "de" && dictVerb !== false
    && (dictVerb === true || hasCompleteGermanVerbForms(parsed.forms) || looksLikeGermanInfinitive(front));
  const lemma = candidate ? (dictionary?.lemma || front).replace(/^sich\s+/iu, "") : undefined;
  const known = dictionary && hasCompleteGermanVerbForms(dictionary.forms) ? dictionary.forms : parsed.forms;
  const { summary } = useGermanVerbSummary(lemma, lang, nativeLang, known);
  return { summary, details: summary ? parsed.rest : details };
}
