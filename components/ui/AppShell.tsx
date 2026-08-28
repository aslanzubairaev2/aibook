"use client";

import { BookOpen, Home, Library, Repeat, Settings, SquareStack, Globe } from "lucide-react";
import type { AppSection } from "@/lib/types";

type Props = {
  activeSection: AppSection;
  onSectionChange: (s: AppSection) => void;
  children: React.ReactNode;
};

const NAV = [
  { id: "home" as AppSection, label: "Главная", Icon: Home },
  { id: "discover" as AppSection, label: "Каталог", Icon: Globe },
  { id: "books" as AppSection, label: "Книги", Icon: Library },
  { id: "cards" as AppSection, label: "Карточки", Icon: SquareStack },
  { id: "verbs" as AppSection, label: "Глаголы", Icon: Repeat },
  { id: "settings" as AppSection, label: "Настройки", Icon: Settings },
];

/**
 * Sections that own the whole viewport: the tab bar is hidden and the shell
 * stops scrolling, so the screen can lay itself out against a fixed height
 * instead of fighting the 88px the nav normally reserves at the bottom.
 */
const IMMERSIVE: ReadonlySet<AppSection> = new Set<AppSection>(["live-translate"]);

export function AppShell({ activeSection, onSectionChange, children }: Props) {
  const immersive = IMMERSIVE.has(activeSection);

  return (
    <div className={`app-shell${immersive ? " app-shell--immersive" : ""}`}>
      <main className={`app-main${immersive ? " app-main--immersive" : ""}`}>{children}</main>
      {!immersive && (
        <nav className="bottom-nav" aria-label="Навигация">
          {NAV.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              className={`nav-item${activeSection === id ? " active" : ""}`}
              onClick={() => onSectionChange(id)}
              aria-current={activeSection === id ? "page" : undefined}
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
