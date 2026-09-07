import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

function readKey(request: NextRequest) {
  const url = new URL(request.url);
  const youtubeId = url.searchParams.get("video_id") || "";
  const nativeLanguage = url.searchParams.get("native_language") || "";
  const targetLanguage = url.searchParams.get("target_language") || "";
  const transcriptHash = url.searchParams.get("transcript_hash") || "";
  if (!/^[\w-]{1,200}$/u.test(youtubeId) || !/^[a-zA-Z-]{2,20}$/u.test(nativeLanguage)
    || !/^[a-zA-Z-]{2,20}$/u.test(targetLanguage) || !/^[a-f0-9]{64}$/u.test(transcriptHash)) return null;
  return { youtubeId, nativeLanguage, targetLanguage, transcriptHash };
}

export async function GET(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const key = readKey(request);
  if (!key) return NextResponse.json({ error: "Некорректный ключ прогресса" }, { status: 400 });
  const { data: exact, error } = await supabaseAdmin.from("video_training_progress").select("session,updated_at")
    .eq("user_id", user.id).match({ youtube_id: key.youtubeId, native_language: key.nativeLanguage, target_language: key.targetLanguage, transcript_hash: key.transcriptHash }).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (exact) return NextResponse.json({ progress: exact });
  const { data: fallback, error: fallbackError } = await supabaseAdmin.from("video_training_progress")
    .select("session,updated_at,transcript_hash")
    .eq("user_id", user.id).eq("youtube_id", key.youtubeId)
    .eq("native_language", key.nativeLanguage).eq("target_language", key.targetLanguage)
    .order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (fallbackError) return NextResponse.json({ error: fallbackError.message }, { status: 500 });
  return NextResponse.json({ progress: fallback ?? null });
}

export async function POST(request: NextRequest) {
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase не настроен" }, { status: 503 });
  const user = await getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.video_id !== "string" || typeof body.native_language !== "string" || typeof body.target_language !== "string"
    || typeof body.transcript_hash !== "string" || !body.session || typeof body.session !== "object") return NextResponse.json({ error: "Некорректные данные прогресса" }, { status: 400 });
  const key = readKey(new NextRequest(`https://aibook.local/api/videos/training-progress?video_id=${encodeURIComponent(body.video_id)}&native_language=${encodeURIComponent(body.native_language)}&target_language=${encodeURIComponent(body.target_language)}&transcript_hash=${encodeURIComponent(body.transcript_hash)}`));
  if (!key || JSON.stringify(body.session).length > 200000) return NextResponse.json({ error: "Некорректный ключ прогресса" }, { status: 400 });
  const { error } = await supabaseAdmin.from("video_training_progress").upsert({ user_id: user.id, youtube_id: key.youtubeId, native_language: key.nativeLanguage, target_language: key.targetLanguage, transcript_hash: key.transcriptHash, session: body.session, updated_at: new Date().toISOString() }, { onConflict: "user_id,youtube_id,native_language,target_language,transcript_hash" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
