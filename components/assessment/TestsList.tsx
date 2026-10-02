"use client";

// Tests the teacher agent has published, on the home screen: one dense row each.

import { useEffect, useState } from "react";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { useAuth } from "@/lib/auth/useAuth";

type TestRow = {
  id: string;
  title: string;
  mode: "learning" | "diagnostic";
  state: "new" | "in_progress" | "submitted" | "reviewed";
  answered: number;
  items: number | null;
};

const STATE_LABEL: Record<TestRow["state"], string> = {
  new: "новый",
  in_progress: "в процессе",
  submitted: "ждёт проверки",
  reviewed: "результаты",
};

export function TestsList() {
  const { user } = useAuth();
  const [tests, setTests] = useState<TestRow[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/assessments", { headers: await sbAuthHeaders() });
        const json = await response.json();
        if (!cancelled && Array.isArray(json.tests)) setTests(json.tests);
      } catch { /* no tests row is fine */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  if (tests.length === 0) return null;
  return (
    <section className="asm-home">
      <h2 className="asm-home-title"><ClipboardCheck size={16} /> Тесты от преподавателя</h2>
      <ul>
        {tests.slice(0, 6).map((t) => (
          <li key={t.id}>
            <a href={`/test/${t.id}`} className={`asm-home-row is-${t.state}`}>
              <span className="asm-home-name">{t.title}</span>
              <span className="asm-muted asm-small">
                {STATE_LABEL[t.state]}{t.state === "in_progress" && t.items ? ` · ${t.answered}/${t.items}` : ""}
              </span>
              <ChevronRight size={16} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
