"use client";

// Logging a trainer answer from the browser.
//
// Every answer goes into a queue in localStorage first (per signed-in user),
// then out to /api/training-events in batches: shortly after answering, when
// the connection comes back, and when the page is hidden. An event leaves the
// queue only once the server has confirmed it; its client_event_id means a
// resend after a lost reply is ignored rather than stored twice. Nothing here
// may ever interrupt a drill — every failure just waits for the next flush.

import { sbAuthHeaders } from "@/lib/db/supabase";
import { getLocalNamespace } from "@/lib/db/local";
import { localDay, type Check, type Outcome, type Trainer, type TrainingEvent } from "./events";

export type TrainingEventInput = {
  trainer: Trainer;
  checks: Check;
  outcome: Outcome;
  word: string;
  mode?: string | null;
  sessionId?: string | null;
  entryId?: string | null;
  cardId?: string | null;
  form?: string | null;
  pronoun?: string | null;
  tense?: string | null;
  prompt?: string | null;
  answer?: string | null;
  expected?: string | null;
  attemptNo?: number;
  hintUsed?: boolean;
  answerShown?: boolean;
  selfGrade?: number | null;
  meta?: Record<string, unknown>;
};

const MAX_QUEUE = 2000;
const BATCH = 200;
const FLUSH_DELAY_MS = 2500;

function queueKey(): string {
  return `aibook:training-events:${getLocalNamespace()}`;
}

function readQueue(): TrainingEvent[] {
  try {
    const raw = window.localStorage.getItem(queueKey());
    return raw ? (JSON.parse(raw) as TrainingEvent[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(events: TrainingEvent[]) {
  try {
    window.localStorage.setItem(queueKey(), JSON.stringify(events.slice(-MAX_QUEUE)));
  } catch {
    // Storage full or blocked: the event is lost, the drill is not.
  }
}

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

let timer: number | null = null;
let flushing = false;
let listening = false;

function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("online", () => void flushTrainingEvents());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushTrainingEvents(true);
  });
}

export function logTrainingEvent(input: TrainingEventInput) {
  if (typeof window === "undefined") return;
  const now = new Date();
  const event: TrainingEvent = {
    client_event_id: newId(),
    occurred_at: now.toISOString(),
    ...localDay(now),
    trainer: input.trainer,
    mode: input.mode ?? null,
    session_id: input.sessionId ?? null,
    entry_id: input.entryId ?? null,
    card_id: input.cardId ?? null,
    word: input.word ?? "",
    checks: input.checks,
    form: input.form ?? null,
    pronoun: input.pronoun ?? null,
    tense: input.tense ?? null,
    prompt: input.prompt ?? null,
    answer: input.answer ?? null,
    expected: input.expected ?? null,
    outcome: input.outcome,
    attempt_no: input.attemptNo ?? 1,
    hint_used: input.hintUsed === true,
    answer_shown: input.answerShown === true,
    self_grade: input.selfGrade ?? null,
    meta: input.meta ?? {},
  };
  writeQueue([...readQueue(), event]);
  listen();
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => void flushTrainingEvents(), FLUSH_DELAY_MS);
}

/** Send what is queued. Safe to call any time; concurrent calls collapse into one. */
export async function flushTrainingEvents(keepalive = false): Promise<void> {
  if (flushing || typeof window === "undefined" || !navigator.onLine) return;
  const queue = readQueue();
  if (queue.length === 0) return;
  const headers = await sbAuthHeaders();
  if (!headers.Authorization) return; // signed out: keep them for later
  flushing = true;
  try {
    for (let i = 0; i < queue.length; i += BATCH) {
      const batch = queue.slice(i, i + BATCH);
      const response = await fetch("/api/training-events", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ events: batch }),
        keepalive: keepalive && i === 0,
      });
      if (!response.ok) break;
      // Remove only what was confirmed; new events may have arrived meanwhile.
      const sent = new Set(batch.map((e) => e.client_event_id));
      writeQueue(readQueue().filter((e) => !sent.has(e.client_event_id)));
    }
  } catch {
    // Offline or the server is down: the queue stays for the next flush.
  } finally {
    flushing = false;
  }
}

/** An answer verdict from checkTypedAnswer → the event's outcome. */
export { outcomeFromVerdict } from "./events";
