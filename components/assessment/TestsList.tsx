"use client";

// Tests from the teacher agent.
//
// Home shows only news: a test that has not been opened yet, and results
// that are out but not looked at. Opening it once clears it from home.
// Каталог → Тесты has all of them, grouped, with progress and dates.

import { useEffect, useState } from "react";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";

export type TestRow = {
  id: string;
  title: string;
  description: string;
  mode: "learning" | "diagnostic";
  published_at: string | null;
  state: "new" | "in_progress" | "awaiting_review" | "results";
  notify: "new" | "results" | null;
  answered: number;
  items: number | null;
  started_at: string | null;
  updated_at: string | null;
  submitted_at: string | null;
  result: { score: number; max: number; percent: number | null } | null;
};

export function useTests() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [tests, setTests] = useState<TestRow[] | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/assessments", { headers: await sbAuthHeaders() });
        const json = await response.json();
        if (!cancelled) setTests(Array.isArray(json.tests) ? json.tests : []);
      } catch {
        if (!cancelled) setTests([]);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  return tests;
}

/** Home: only what is new. Nothing at all when there is no news. */
export function TestsList({ onOpenAll }: { onOpenAll?: () => void }) {
  const tests = useTests();
  const news = (tests ?? []).filter((t) => t.notify);
  if (news.length === 0) return null;
  return (
    <section className="asm-home">
      <h2 className="asm-home-title">
        <ClipboardCheck size={16} /> Тесты от преподавателя
        {onOpenAll && <button type="button" className="asm-home-all" onClick={onOpenAll}>Все тесты</button>}
      </h2>
      <ul>
        {news.map((t) => (
          <li key={t.id}>
            <a href={`/test/${t.id}`} className={`asm-home-row is-${t.notify}`}>
              <span className="asm-home-name">{t.title}</span>
              <span className="asm-home-badge">
                {t.notify === "new" ? "новый тест" : t.result?.percent != null ? `результаты · ${t.result.percent}%` : "результаты готовы"}
              </span>
              <ChevronRight size={16} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

const GROUPS: { state: TestRow["state"]; title: string }[] = [
  { state: "in_progress", title: "В процессе" },
  { state: "new", title: "Новые" },
  { state: "awaiting_review", title: "Ждут проверки" },
  { state: "results", title: "Завершённые" },
];

/** Каталог → Тесты: every test, where it stands. */
export function TestsTab() {
  const tests = useTests();
  if (tests === null) return <p className="asm-muted asm-tab-empty">Загрузка…</p>;
  if (tests.length === 0) {
    return <p className="asm-muted asm-tab-empty">Тестов пока нет. Попросите преподавателя-агента: «проверь мой немецкий».</p>;
  }
  return (
    <div className="asm-tests-tab">
      {GROUPS.map((group) => {
        const rows = tests.filter((t) => t.state === group.state);
        if (rows.length === 0) return null;
        return (
          <section key={group.state}>
            <h3 className="asm-group-title">{group.title} <span className="asm-muted">{rows.length}</span></h3>
            <ul className="asm-test-rows">
              {rows.map((t) => {
                const progress = t.items ? Math.round((t.answered / t.items) * 100) : 0;
                return (
                  <li key={t.id}>
                    <a href={`/test/${t.id}`} className="asm-test-row">
                      <div className="asm-test-main">
                        <strong>{t.title}</strong>
                        {t.description && <span className="asm-muted asm-small">{t.description}</span>}
                        <span className="asm-muted asm-small">
                          {t.mode === "diagnostic" ? "Диагностика" : "Обучение"}
                          {t.state === "new" && t.published_at ? ` · получен ${when(t.published_at)}` : ""}
                          {t.state === "in_progress" ? ` · начат ${when(t.started_at)} · последний ответ ${when(t.updated_at)}` : ""}
                          {(t.state === "awaiting_review" || t.state === "results") && t.submitted_at ? ` · сдан ${when(t.submitted_at)}` : ""}
                        </span>
                        {t.state === "in_progress" && t.items ? (
                          <span className="asm-test-progress">
                            <span className="asm-progress"><span style={{ width: `${progress}%` }} /></span>
                            <span className="asm-small">{t.answered} из {t.items}</span>
                          </span>
                        ) : null}
                      </div>
                      <span className="asm-test-side">
                        {t.state === "results" && t.result ? (
                          <strong>{t.result.percent ?? "—"}%</strong>
                        ) : t.state === "awaiting_review" ? (
                          <span className="asm-muted asm-small">ждёт проверки</span>
                        ) : null}
                        {t.notify && <span className="asm-dot" aria-label="новое" />}
                        <ChevronRight size={16} />
                      </span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
