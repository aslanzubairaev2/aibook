import { NextResponse } from "next/server";
import { resumeHook } from "workflow/api";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";

export const dynamic = "force-dynamic";

async function ownedJob(id: string, userId: string) {
  if (!supabaseAdmin) return null;
  const { data } = await supabaseAdmin.from("dictionary_generation_jobs").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  return data;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(_req);
  if (!user) return NextResponse.json({ error: "Войдите, чтобы открыть задачу." }, { status: 401 });
  const { id } = await params;
  const job = await ownedJob(id, user.id);
  if (!job) return NextResponse.json({ error: "Задача не найдена." }, { status: 404 });
  return NextResponse.json({ job });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Войдите, чтобы продолжить задачу." }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });
  const { id } = await params;
  const body = await req.json() as { answer?: unknown };
  const answer = String(body.answer ?? "").trim().slice(0, 1200);
  if (!answer) return NextResponse.json({ error: "Напишите или наговорите ответ." }, { status: 400 });
  const job = await ownedJob(id, user.id) as { status?: string; hook_token?: string | null } | null;
  if (!job) return NextResponse.json({ error: "Задача не найдена." }, { status: 404 });
  if (job.status !== "waiting_input" || !job.hook_token) return NextResponse.json({ error: "Эта задача сейчас не ждёт уточнения." }, { status: 409 });

  const resumed = await resumeHook(job.hook_token, { answer });
  if (!resumed) return NextResponse.json({ error: "Уточнение уже было принято. Обновите окно задачи." }, { status: 409 });
  await supabaseAdmin.from("dictionary_generation_jobs").update({ current_action: "Ответ получен, продолжаю работу…", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}

