// The shape of the view the server sends (lib/assessments/publicView.ts),
// written out for the client: it arrives as JSON, so the components read it
// through these types rather than the server's inferred ones.

import { sbAuthHeaders } from "@/lib/db/supabase";
import type { ItemType, Skill } from "@/lib/assessments/model";

export type AnswerValue = string | string[] | Record<string, string>;

export type ViewFeedback = {
  status: "correct" | "partial" | "incorrect" | "dont_know" | "unanswered" | "pending_review";
  score: number | null;
  max: number;
  expected: string;
  explanation: string;
  notes: string[];
  teacher_comment: string;
  corrected: string;
};

export type ViewItem = {
  id: string;
  type: ItemType;
  prompt: string;
  points: number;
  hint: string;
  options?: { id: string; text: string }[];
  text?: string;
  gaps?: { id: string; options?: string[] }[];
  words?: string[];
  min_words?: number | null;
  max_words?: number | null;
  answer: { value: AnswerValue | null; draft: AnswerValue | null; status: "answered" | "dont_know" | null; tries: number };
  locked: boolean;
  feedback: ViewFeedback | null;
  try_again: boolean;
};

export type ViewStimulus =
  | { type: "text"; title: string; paragraphs: string[]; translation: string[] }
  | {
      type: "audio";
      kind: "monologue" | "dialogue";
      speakers: string[];
      max_plays: number | null;
      used: number;
      remaining: number | null;
      unlock_questions: "immediately" | "after_first_play";
      audio_status: "pending" | "ready" | "error";
      duration_ms: number | null;
      transcript: { speaker: string; text: string }[] | null;
    };

export type ViewSection = {
  id: string;
  title: string;
  instructions: string;
  skill: Skill;
  stimulus: ViewStimulus | null;
  questions_locked: boolean;
  items: ViewItem[];
  item_count: number;
  answered: number;
  completed: boolean;
  available: boolean;
};

export type View = {
  assessment: {
    id: string;
    title: string;
    description: string;
    mode: "learning" | "diagnostic";
    language: string;
    results_release: string;
    section_order: "sequential" | "free";
  };
  attempt: { id: string; status: "in_progress" | "submitted" | "reviewed"; started_at: string; submitted_at: string | null };
  current_section_id: string | null;
  sections: ViewSection[];
  results: {
    totals: { score: number; max: number; percent: number | null; pending_review: number; unanswered: number; dont_know: number };
    skills: { skill: Skill; score: number; max: number; percent: number | null; items: number; pending_review: number }[];
    dimensions: Record<string, { errors: number; minor: number; ok: number }>;
    summary: string;
    gaps: { topic: string; description: string }[];
  } | null;
  awaiting_review: boolean;
};

export const SKILL_NAMES: Record<Skill, string> = {
  reading: "Чтение",
  listening: "Аудирование",
  writing: "Письмо",
  grammar: "Грамматика",
  vocabulary: "Словарь",
};

export const DIMENSION_NAMES: Record<string, string> = {
  meaning: "Понимание смысла",
  grammar: "Грамматика",
  vocabulary: "Словарь",
  spelling: "Орфография",
  instruction: "Выполнение инструкции",
};

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function assessmentApi<T = { view: View }>(id: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`/api/assessments/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await sbAuthHeaders()) },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(json.error || `Ошибка ${response.status}`, response.status);
  return json as T;
}

export function isEmptyAnswer(value: AnswerValue | null | undefined): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value).every((v) => !String(v).trim());
}
