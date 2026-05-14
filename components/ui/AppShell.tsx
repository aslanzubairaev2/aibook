"use client";

import { BookOpen, Home, Library, Settings, SquareStack } from "lucide-react";
import type { AppSection } from "@/lib/types";

type Props = {
  activeSection: AppSection;
  onSectionChange: (s: AppSection) => void;
  children: React.ReactNode;
};

const NAV = [
  { id: "home" as AppSection, label: "Главная", Icon: Home },
  { id: "books" as AppSection, label: "Книги", Icon: Library },
  { id: "reader" as AppSection, label: "Читалка", Icon: BookOpen },
  { id: "cards" as AppSection, label: "Карточки", Icon: SquareStack },
  { id: "settings" as AppSection, label: "Настройки", Icon: Settings },
];

export function AppShell({ activeSection, onSectionChange, children }: Props) {
  return (
    <div className="app-shell">
      <main className="app-main">{children}</main>
      <nav className="bottom-nav" aria-label="Навигация">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={`nav-item${activeSection === id ? " active" : ""}`}
            onClick={() => onSectionChange(id)}
            aria-current={activeSection === id ? "page" : undefined}
          >
            <Icon size={21} aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
