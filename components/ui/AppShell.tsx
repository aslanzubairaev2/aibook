"use client";

import { BookA, Dumbbell, Home, Settings, Globe } from "lucide-react";
import type { AppSection } from "@/lib/types";

type Props = {
  activeSection: AppSection;
  onSectionChange: (s: AppSection) => void;
  children: React.ReactNode;
};

// Five slots, one per thing the learner actually goes looking for. Книги live
// inside Каталог and on the home screen; Карточки, Глаголы and Существительные
// are three drills over the same words, so they sit behind Практика rather than
// each taking a slot of their own.
const NAV = [
  { id: "home" as AppSection, label: "Главная", Icon: Home },
  { id: "discover" as AppSection, label: "Каталог", Icon: Globe },
  { id: "dictionary" as AppSection, label: "Словарь", Icon: BookA },
  { id: "practice" as AppSection, label: "Практика", Icon: Dumbbell },
  { id: "settings" as AppSection, label: "Настройки", Icon: Settings },
];

/**
 * Which tab lights up for a screen reached from one of them: the trainers are
 * Практика, the reader and the library are the shelf the book came from. A
 * screen with no home tab simply lights nothing.
 */
const NAV_PARENT: Partial<Record<AppSection, AppSection>> = {
  cards: "practice",
  verbs: "practice",
  nouns: "practice",
  books: "home",
  reader: "home",
  homework: "discover",
};

/**
 * Sections that own the whole viewport: the tab bar is hidden and the shell
 * stops scrolling, so the screen can lay itself out against a fixed height
 * instead of fighting the 88px the nav normally reserves at the bottom.
 */
const IMMERSIVE: ReadonlySet<AppSection> = new Set<AppSection>(["live-translate"]);

export function AppShell({ activeSection, onSectionChange, children }: Props) {
  const immersive = IMMERSIVE.has(activeSection);
  const highlighted = NAV_PARENT[activeSection] ?? activeSection;

  return (
    <div className={`app-shell${immersive ? " app-shell--immersive" : ""}`}>
      <main className={`app-main${immersive ? " app-main--immersive" : ""}`}>{children}</main>
      {!immersive && (
        <nav className="bottom-nav" aria-label="Навигация">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item${highlighted === id ? " active" : ""}`}
              onClick={() => onSectionChange(id)}
              aria-current={highlighted === id ? "page" : undefined}
            >
              <Icon size={18} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
