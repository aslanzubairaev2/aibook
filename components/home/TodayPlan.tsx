"use client";

// «Сегодня»: the whole day's load in one list.
//
// One dense row per trainer — how many reviews are waiting, how much new
// material there is — and a tap opens that trainer. Everything is read from
// what the device already holds (the deck in memory, the dictionary caches,
// the trainers' own progress), so the list is there the moment home is shown
// and costs no request.

import { useEffect, useMemo, useState } from "react";
import { BookA, BookOpen, Check, ChevronRight, Flame, Link2, Repeat, Layers } from "lucide-react";
import {
  getCardVariantProgressMap, getLocalConjugationTenses, getLocalNounsDict, getLocalOtherPosDict,
  getLocalPackProgress, getLocalVerbsDict, getLocalVerbsQuizModes,
} from "@/lib/db/local";
import { normalizeNewPerDay } from "@/lib/cards";
import { isAdjectiveEntry } from "@/lib/adjectiveEndings";
import { isNounEntry, nounGender } from "@/lib/nounForms";
import { isPrepositionEntry, prepositionCaseFor } from "@/lib/prepositionForms";
import { PROGRESS_SYNCED_EVENT } from "@/lib/sync/progressSync";
import { buildTodayPlan, type TodayRow, type TodayTrainer } from "@/lib/today";
import { normalizePos } from "@/lib/verbForms";
import type { Book, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  books: Book[];
  profile: UserProfile;
  /** Bumped by the app whenever progress was refreshed from the account. */
  revision?: number;
  onOpenTrainer: (trainer: TodayTrainer) => void;
  onOpenBook: (book: Book) => void;
};

const TRAINERS: Record<TodayTrainer, { title: string; unit: string; icon: typeof Flame }> = {
  cards: { title: "Карточки", unit: "повторений", icon: Layers },
  verbs: { title: "Глаголы", unit: "глаголов", icon: Repeat },
  nouns: { title: "Существительные", unit: "слов", icon: BookA },
  otherpos: { title: "Предлоги и прилагательные", unit: "слов", icon: Link2 },
};

function rowNote(row: TodayRow): string {
  if (row.review > 0) return row.fresh > 0 ? `и ${row.fresh} новых` : "к повторению";
  if (row.fresh > 0) return `новых: ${row.fresh}`;
  return "на сегодня всё";
}

export function TodayPlan({ cards, books, profile, revision = 0, onOpenTrainer, onOpenBook }: Props) {
  // The trainers' progress lives outside React; re-read it when another
  // device's answers have just been merged in.
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => {
    const bump = () => setSyncTick((n) => n + 1);
    window.addEventListener(PROGRESS_SYNCED_EVENT, bump);
    return () => window.removeEventListener(PROGRESS_SYNCED_EVENT, bump);
  }, []);

  const language = profile.targetLanguage;
  const newPerDay = normalizeNewPerDay(profile.cardFilters?.newPerDay);

  const plan = useMemo(() => {
    const verbs = (getLocalVerbsDict(language)?.entries ?? []).filter((e) => normalizePos(e.part_of_speech).includes("глагол"));
    const nouns = (getLocalNounsDict(language)?.entries ?? []).filter((e) => isNounEntry(e) && nounGender(e) !== null);
    const otherPos = (getLocalOtherPosDict(language)?.entries ?? [])
      .filter((e) => (isPrepositionEntry(e) && prepositionCaseFor(e) !== null) || isAdjectiveEntry(e));
    return buildTodayPlan({
      cards,
      variantProgress: getCardVariantProgressMap(),
      newPerDay,
      verbs: { entries: verbs, progress: getLocalPackProgress("verbs"), modes: getLocalVerbsQuizModes(), tenses: getLocalConjugationTenses() },
      nouns: { entries: nouns, progress: getLocalPackProgress("nouns") },
      otherPos: { entries: otherPos, progress: getLocalPackProgress("otherpos") },
    });
    // syncTick / revision are re-read triggers for the stores read above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, language, newPerDay, syncTick, revision]);

  // The book being read: unfinished, and the furthest along is the likeliest.
  const reading = useMemo(
    () => books
      .filter((b) => b.language === language && b.progress > 0 && b.progress < 100)
      .sort((a, b) => b.progress - a.progress)[0] ?? null,
    [books, language],
  );

  const rows = plan.rows.filter((row) => row.review > 0 || row.fresh > 0);
  if (rows.length === 0 && !reading) return null;

  return (
    <section className="today-plan" aria-label="План на сегодня">
      <div className="today-plan-head">
        <h2 className="today-plan-title">Сегодня</h2>
        <span className="today-plan-meta">
          {plan.totalReview > 0 ? `${plan.totalReview} к повторению` : "повторения сделаны"}
          {plan.doneToday > 0 ? ` · сделано ${plan.doneToday}` : ""}
          {plan.streak > 1 ? ` · ${plan.streak} дн. подряд` : ""}
        </span>
      </div>

      <ul className="today-plan-list">
        {rows.map((row) => {
          const meta = TRAINERS[row.trainer];
          const Icon = meta.icon;
          const done = row.review === 0;
          return (
            <li key={row.trainer}>
              <button type="button" className={`today-plan-row ${done ? "done" : ""}`} onClick={() => onOpenTrainer(row.trainer)}>
                <span className="today-plan-icon"><Icon size={17} /></span>
                <span className="today-plan-name">{meta.title}</span>
                <span className="today-plan-count">
                  {done ? <Check size={15} aria-hidden /> : <strong>{row.review}</strong>}
                  <span className="today-plan-note">{rowNote(row)}</span>
                </span>
                <ChevronRight size={16} className="today-plan-arrow" />
              </button>
            </li>
          );
        })}
        {reading && (
          <li>
            <button type="button" className="today-plan-row done" onClick={() => onOpenBook(reading)}>
              <span className="today-plan-icon"><BookOpen size={17} /></span>
              <span className="today-plan-name">{reading.title}</span>
              <span className="today-plan-count">
                <span className="today-plan-note">читать дальше · {Math.round(reading.progress)}%</span>
              </span>
              <ChevronRight size={16} className="today-plan-arrow" />
            </button>
          </li>
        )}
      </ul>

      {plan.struggling > 0 && (
        <p className="today-plan-foot">Трудных слов во всех тренажёрах: {plan.struggling}</p>
      )}
    </section>
  );
}
