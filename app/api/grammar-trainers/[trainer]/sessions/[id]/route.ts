// One assigned grammar-trainer session: read it to build its tasks, mark it
// started or completed.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { parseTrainer } from "@/lib/grammar/config";
import { dueKeys } from "@/lib/grammar/stats";
import { getSession, markSession } from "@/lib/grammar/store";
import { readGrammarEvents } from "@/lib/training/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ trainer: string; id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const { trainer: raw, id } = await params;
  const trainer = parseTrainer(raw);
  if (!trainer) return NextResponse.json({ error: "Unknown trainer" }, { status: 404 });
  const [session, events] = await Promise.all([
    getSession(supabaseAdmin, user.id, trainer, id, new URL(req.url).origin),
    readGrammarEvents(supabaseAdmin, user.id, trainer, "last_30_days").catch(() => []),
  ]);
  if (!session) return NextResponse.json({ error: "Тренировка не найдена." }, { status: 404 });
  return NextResponse.json({ session, due: dueKeys(events) });
}

export async function POST(req: Request, { params }: { params: Promise<{ trainer: string; id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const { id } = await params;
  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (body.action !== "start" && body.action !== "complete") return NextResponse.json({ error: "action must be start or complete" }, { status: 400 });
  try {
    await markSession(supabaseAdmin, user.id, id, body.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("grammar session:", error);
    return NextResponse.json({ error: "Не удалось обновить тренировку." }, { status: 500 });
  }
}
