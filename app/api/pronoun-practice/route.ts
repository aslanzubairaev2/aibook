// The pronoun trainer's settings, open assignments and statistics for the
// signed-in learner. Writes go through the same validation the MCP tools use.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { dueDifficulties, pronounSummary } from "@/lib/pronouns/stats";
import { listSessions, readConfig, readReviews, writeConfig } from "@/lib/pronouns/store";
import { readPronounEvents } from "@/lib/training/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const origin = new URL(req.url).origin;
  const withStats = new URL(req.url).searchParams.get("stats") === "1";
  try {
    const [config, sessions, events, reviews] = await Promise.all([
      readConfig(supabaseAdmin, user.id),
      listSessions(supabaseAdmin, user.id, origin, true),
      // The home screen only needs recent difficulties; statistics read everything.
      readPronounEvents(supabaseAdmin, user.id, withStats ? "all" : "last_30_days"),
      readReviews(supabaseAdmin, user.id),
    ]);
    return NextResponse.json({
      ...config,
      sessions,
      due_difficulties: dueDifficulties(events, reviews),
      stats: withStats ? pronounSummary(events, reviews) : undefined,
    });
  } catch (error) {
    console.error("pronoun practice:", error);
    return NextResponse.json({ error: "Не удалось загрузить настройки тренировки." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  let body: { config?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json(await writeConfig(supabaseAdmin, user.id, body.config ?? {}, "learner"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить настройки." }, { status: 400 });
  }
}
