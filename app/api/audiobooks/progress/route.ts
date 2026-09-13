import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

const AUDIOBOOK_ID = /^[\w.-]{1,200}$/u;
const MAX_SECONDS = 24 * 60 * 60 * 365;

function validAudiobookId(value: unknown): value is string {
  return typeof value === "string" && AUDIOBOOK_ID.test(value);
}

function finiteSeconds(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_SECONDS;
}

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== "string") return new Date().toISOString();
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return new Date().toISOString();
  // Do not allow a badly skewed client clock to pin the row in the future.
  const now = Date.now();
  return new Date(Math.min(parsed, now + 5 * 60 * 1000)).toISOString();
}

async function authenticated(request: NextRequest) {
  if (!supabaseAdmin) return { response: NextResponse.json({ error: "Supabase не настроен" }, { status: 503 }) };
  const user = await getUserFromRequest(request);
  if (!user) return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const auth = await authenticated(request);
  if (auth.response) return auth.response;
  const audiobookId = request.nextUrl.searchParams.get("audiobook_id");
  if (audiobookId !== null && !validAudiobookId(audiobookId)) {
    return NextResponse.json({ error: "Некорректный audiobook_id" }, { status: 400 });
  }

  let query = supabaseAdmin!.from("audiobook_progress")
    .select("audiobook_id,chapter_index,current_time_seconds,duration_seconds,updated_at")
    .eq("user_id", auth.user!.id)
    .order("updated_at", { ascending: false });
  if (audiobookId) query = query.eq("audiobook_id", audiobookId);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ progress: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await authenticated(request);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const audiobookId = body?.audiobook_id;
  const chapterIndex = body?.chapter_index;
  const currentTimeSeconds = body?.current_time_seconds;
  const durationSeconds = body?.duration_seconds;
  if (!validAudiobookId(audiobookId) || !Number.isInteger(chapterIndex) || (chapterIndex as number) < 0
    || !finiteSeconds(currentTimeSeconds) || !finiteSeconds(durationSeconds)) {
    return NextResponse.json({ error: "Некорректные данные прогресса" }, { status: 400 });
  }

  const updatedAt = parseUpdatedAt(body?.updated_at);
  const { data: existing, error: readError } = await supabaseAdmin!.from("audiobook_progress")
    .select("updated_at")
    .eq("user_id", auth.user!.id)
    .eq("audiobook_id", audiobookId)
    .maybeSingle();
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (existing && Date.parse(existing.updated_at) >= Date.parse(updatedAt)) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { error } = await supabaseAdmin!.from("audiobook_progress").upsert({
    user_id: auth.user!.id,
    audiobook_id: audiobookId,
    chapter_index: chapterIndex,
    current_time_seconds: currentTimeSeconds,
    duration_seconds: durationSeconds,
    updated_at: updatedAt,
  }, { onConflict: "user_id,audiobook_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
