// One assigned pronoun session: read it to build its tasks, mark it started
// or completed.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { getSession, markSession, readConfig } from "@/lib/pronouns/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const { id } = await params;
  const [session, config] = await Promise.all([getSession(supabaseAdmin, user.id, id, new URL(req.url).origin), readConfig(supabaseAdmin, user.id)]);
  if (!session) return NextResponse.json({ error: "Тренировка не найдена." }, { status: 404 });
  return NextResponse.json({ session, config: config.config });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    console.error("pronoun session:", error);
    return NextResponse.json({ error: "Не удалось обновить тренировку." }, { status: 500 });
  }
}
