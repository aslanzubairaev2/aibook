"use client";

import { useMemo, useState } from "react";
import { BookA, ChevronRight, Flame, Repeat } from "lucide-react";
import { computeDeckStats } from "@/lib/cards";
import { getCardVariantProgressMap, getLocalNounsDict, getLocalVerbsDict } from "@/lib/db/local";
import { isNounEntry, nounGender } from "@/lib/nounForms";
import { normalizePos } from "@/lib/verbForms";
import type { Flashcard, UserProfile } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  profile: UserProfile;
  onOpenCards: () => void;
  onOpenVerbs: () => void;
  onOpenNouns: () => void;
};

/**
 * The one place the app trains anything.
 *
 * Карточки, Глаголы and Существительные used to be three unrelated entries
 * competing for room in a five-slot tab bar; they are three drills over the
 * same dictionary, so they belong behind one door. Each row says how much
 * material it currently has, read from the caches the screens themselves keep
 * — so the numbers are there instantly and cost no network call.
 */
export function PracticeView({ cards, profile, onOpenCards, onOpenVerbs, onOpenNouns }: Props) {
  // The card module's own boundary for "due today", so this tile and the
  // trainer can never disagree about the number.
  const todayEndTime = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    return end.getTime();
  }, []);

  const dueCards = useMemo(
    () => computeDeckStats(cards, getCardVariantProgressMap(), new Date(todayEndTime)).dueCards,
    [cards, todayEndTime],
  );

  // Read once at mount: the counts are a hint about how much there is to do,
  // not a live figure worth a request every time this screen is opened.
  const counts = useState(() => {
    const verbs = getLocalVerbsDict(profile.targetLanguage)?.entries ?? [];
    const nouns = getLocalNounsDict(profile.targetLanguage)?.entries ?? [];
    return {
      verbs: verbs.filter((e) => normalizePos(e.part_of_speech).includes("глагол")).length,
      nouns: nouns.filter((e) => isNounEntry(e.part_of_speech) && nounGender(e) !== null).length,
    };
  })[0];

  return (
    <section className="screen practice-view">
      <header className="screen-header">
        <div>
          <p className="eyebrow">Практика</p>
          <h1>Что тренируем</h1>
        </div>
      </header>

      <div className="practice-list">
        <button className="action-card study glass-card" onClick={onOpenCards} type="button">
          <span className="action-card-icon">
            <Flame size={24} fill={dueCards > 0 ? "var(--green)" : "none"} style={{ color: dueCards > 0 ? "var(--green)" : "var(--text-muted)" }} />
          </span>
          <span>
            <span className="action-card-label">Карточки</span>
            <strong className="action-card-title">
              {dueCards > 0 ? `Повторить сегодня: ${dueCards}` : "Изучение слов и фраз"}
            </strong>
            <span className="action-card-sub">Слова, фразы и предложения — интервальное повторение</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>

        <button className="action-card reading glass-card" onClick={onOpenVerbs} type="button">
          <span className="action-card-icon"><Repeat size={24} /></span>
          <span>
            <span className="action-card-label">Глаголы и времена</span>
            <strong className="action-card-title">Формы и спряжения</strong>
            <span className="action-card-sub">
              {counts.verbs > 0 ? `${counts.verbs} глаголов из словаря` : "Infinitiv · Präteritum · Partizip II"}
            </span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>

        <button className="action-card nouns glass-card" onClick={onOpenNouns} type="button">
          <span className="action-card-icon"><BookA size={24} /></span>
          <span>
            <span className="action-card-label">Артикли и существительные</span>
            <strong className="action-card-title">Род и артикли</strong>
            <span className="action-card-sub">
              {counts.nouns > 0 ? `${counts.nouns} существительных из словаря` : "der · die · das и множественное число"}
            </span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      </div>
    </section>
  );
}
