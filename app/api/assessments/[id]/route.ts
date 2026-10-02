// One test, from the learner's side: open it, answer, finish blocks, listen,
// submit. Every action answers with the whole fresh view, built by
// lib/assessments/publicView.ts — the only place that decides what the browser
// may see — so the client never has to guess what changed.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import {
  AssessmentError,
  applyLearnerAction,
  audioLink,
  getLearnerAttempt,
  learnerView,
  openAttempt,
  prepareAudio,
  speechLink,
  startListen,
  type LearnerAction,
} from "@/lib/assessments/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Body = {
  action?: string;
  item_id?: string;
  section_id?: string;
  value?: unknown;
  retake?: boolean;
  recording_id?: string;
  word?: string;
  context?: string;
  unknown?: boolean;
  translation?: string | null;
};

function fail(error: unknown) {
  if (error instanceof AssessmentError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("assessment route:", error);
  return NextResponse.json({ error: "Не удалось выполнить действие." }, { status: 500 });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Войдите в AIBook, чтобы пройти тест." }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const admin = supabaseAdmin;
  const { id } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  try {
    if (body.action === "open" || !body.action) {
      const attempt = await openAttempt(admin, user.id, id, body.retake === true);
      return NextResponse.json({ view: await learnerView(admin, user.id, id, attempt) });
    }

    const attempt = await getLearnerAttempt(admin, user.id, id);
    if (!attempt) throw new AssessmentError("Сначала откройте тест.", 409);

    if (body.action === "audio_url") {
      const url = await audioLink(admin, attempt, String(body.section_id ?? ""));
      return NextResponse.json({ url });
    }

    if (body.action === "listen_start") {
      const used = await startListen(admin, user.id, attempt, String(body.section_id ?? ""));
      const fresh = await getLearnerAttempt(admin, user.id, id);
      return NextResponse.json({ used, view: await learnerView(admin, user.id, id, fresh ?? attempt) });
    }

    if (body.action === "speech_link") {
      const url = await speechLink(admin, attempt, String(body.item_id ?? ""), String(body.recording_id ?? ""));
      return NextResponse.json({ url });
    }

    if (body.action === "retry_audio") {
      // The learner's screen found a recording still pending: give it another
      // push. Claims are atomic, so this never doubles the teacher's call.
      await prepareAudio(admin, user.id, id, { sectionIds: body.section_id ? [String(body.section_id)] : undefined, budgetMs: 20000 });
      return NextResponse.json({ view: await learnerView(admin, user.id, id, attempt) });
    }

    const allowed = ["draft", "answer", "dont_know", "complete_section", "submit", "word_mark"];
    if (!allowed.includes(String(body.action))) throw new AssessmentError("Unknown action.");
    const updated = await applyLearnerAction(admin, attempt, {
      action: body.action,
      item_id: body.action === "word_mark" ? (body.item_id ? String(body.item_id) : null) : String(body.item_id ?? ""),
      section_id: String(body.section_id ?? ""),
      value: body.value,
      word: body.word,
      context: body.context,
      unknown: body.unknown,
      translation: body.translation,
    } as LearnerAction);
    return NextResponse.json({ view: await learnerView(admin, user.id, id, updated) });
  } catch (error) {
    return fail(error);
  }
}
