"use client";

import { ChevronRight, Languages, Phone } from "lucide-react";
import { TestsList } from "@/components/assessment/TestsList";
import { TodayPlan } from "@/components/home/TodayPlan";
import type { TodayTrainer } from "@/lib/today";
import type { Book, Flashcard, UserProfile } from "@/lib/types";

type Props = {
  cards: Flashcard[];
  books: Book[];
  profile: UserProfile;
  progressRevision?: number;
  onOpenTrainer: (trainer: TodayTrainer) => void;
  onOpenBook: (book: Book) => void;
  onOpenTests: () => void;
  onOpenLiveChat: () => void;
  onOpenLiveTranslate: () => void;
};

export function HomeDashboard({ cards, books, profile, progressRevision, onOpenTrainer, onOpenBook, onOpenTests, onOpenLiveChat, onOpenLiveTranslate }: Props) {
  return (
    <section className="screen home-screen">
      <header className="home-header">
        <h1 className="home-title">AIBook</h1>
        <button
          className="icon-btn livechat-fab"
          onClick={onOpenLiveChat}
          type="button"
          aria-label="Голосовой звонок с AI"
          title="Голосовой звонок с AI"
        >
          <Phone size={19} />
        </button>
      </header>

      <TodayPlan
        cards={cards}
        books={books}
        profile={profile}
        revision={progressRevision}
        onOpenTrainer={onOpenTrainer}
        onOpenBook={onOpenBook}
      />

      <button className="live-translate-home-card" onClick={onOpenLiveTranslate} type="button">
        <span className="live-translate-home-icon">
          <Languages size={23} />
        </span>
        <span>
          <span className="action-card-label">Для реального разговора</span>
          <strong className="action-card-title">Live перевод</strong>
          <span className="action-card-sub">Слушайте русский перевод почти без задержки</span>
        </span>
        <ChevronRight size={20} className="action-card-arrow" />
      </button>

      <TestsList onOpenAll={onOpenTests} />
    </section>
  );
}
