// A speaking task's recording: the browser sends 16 kHz mono WAV as the raw
// body (no base64 — a 55-second answer stays well under the platform's request
// limit), the server stores it, has Azure assess it, and answers with the
// fresh view. Retrying with the same recording id never pays Azure twice.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { AssessmentError, getLearnerAttempt, learnerView, submitSpeech } from "@/lib/assessments/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BYTES = 2_400_000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Войдите в AIBook." }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const { id } = await params;
  const url = new URL(req.url);
  const itemId = url.searchParams.get("item_id") ?? "";
  const recordingId = url.searchParams.get("recording_id") ?? "";

  try {
    const body = Buffer.from(await req.arrayBuffer());
    if (body.length === 0) throw new AssessmentError("Пустая запись.");
    if (body.length > MAX_BYTES) throw new AssessmentError("Запись слишком длинная.", 413);
    const attempt = await getLearnerAttempt(supabaseAdmin, user.id, id);
    if (!attempt) throw new AssessmentError("Сначала откройте тест.", 409);
    const { attempt: updated, recording } = await submitSpeech(supabaseAdmin, attempt, itemId, recordingId, body);
    return NextResponse.json({
      recording: { id: recording.id, status: recording.status, technical_reason: recording.technical_reason },
      view: await learnerView(supabaseAdmin, user.id, id, updated),
    });
  } catch (error) {
    if (error instanceof AssessmentError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("speech upload:", error);
    return NextResponse.json({ error: "Не удалось отправить запись." }, { status: 500 });
  }
}
