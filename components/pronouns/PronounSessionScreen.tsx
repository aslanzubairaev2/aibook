"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { sbAuthHeaders } from "@/lib/db/supabase";
import type { PronounConfig, SessionSettings } from "@/lib/pronouns/config";
import { PronounDrill } from "./PronounDrill";

type Loaded = { session: { session_id: string; status: string; settings: SessionSettings }; config: PronounConfig; due: string[] };

/** A teacher's assigned pronoun session, opened from its link. */
export function PronounSessionScreen({ id }: { id: string }) {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keyed on the id, not the user object: a token refresh must not restart the session mid-answer.
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const headers = await sbAuthHeaders();
        const [s, c] = await Promise.all([
          fetch(`/api/pronoun-practice/sessions/${id}`, { headers }).then(async (r) => { const b = await r.json(); if (!r.ok) throw new Error(b.error || "Не удалось открыть тренировку."); return b; }),
          fetch("/api/pronoun-practice", { headers }).then((r) => (r.ok ? r.json() : { due_difficulties: [] })),
        ]);
        if (!cancelled) setData({ session: s.session, config: s.config, due: c.due_difficulties ?? [] });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [userId, id]);

  if (isLoading) return <main className="app-main"><p className="verb-quiz-loading">Загрузка…</p></main>;
  if (!user) return <AuthScreen />;
  if (error) {
    return (
      <main className="app-main">
        <Link href="/" className="secondary-btn"><ArrowLeft size={16} /> AIBook</Link>
        <p className="pron-load-error">{error}</p>
      </main>
    );
  }
  if (!data) return <main className="app-main"><p className="verb-quiz-loading">Загрузка…</p></main>;
  return (
    <main className="app-main pron-standalone">
      <PronounDrill
        settings={data.session.settings}
        enabledModes={data.config.modes}
        dueDifficulties={data.due}
        assignedSessionId={data.session.session_id}
        title={data.session.settings.note || "От преподавателя"}
        onExit={() => router.push("/")}
      />
    </main>
  );
}
