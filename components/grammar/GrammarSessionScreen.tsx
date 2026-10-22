"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/auth/useAuth";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { sbAuthHeaders } from "@/lib/db/supabase";
import type { SessionSettings } from "@/lib/grammar/config";
import type { TrainerId } from "@/lib/grammar/task";
import { GrammarDrill } from "./GrammarDrill";
import { readTestRun } from "./GrammarView";

type Loaded = { session: { session_id: string; status: string; settings: SessionSettings }; due: string[] };

/** A teacher's assigned grammar session, opened from its link. */
export function GrammarSessionScreen({ trainer, id }: { trainer: TrainerId; id: string }) {
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
        const r = await fetch(`/api/grammar-trainers/${trainer}/sessions/${id}`, { headers });
        const body = await r.json();
        if (!r.ok) throw new Error(body.error || "Не удалось открыть тренировку.");
        if (!cancelled) setData({ session: body.session, due: body.due ?? [] });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [userId, id, trainer]);

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
  const s = data.session.settings;
  return (
    <main className="app-main pron-standalone">
      <GrammarDrill trainer={trainer} config={s.config} mode={s.mode} limit={s.item_count} due={data.due}
        assignedSessionId={data.session.session_id} title={s.note || "От преподавателя"} testRun={readTestRun()} onExit={() => router.push("/")} />
    </main>
  );
}
