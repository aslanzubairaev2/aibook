// A grammar trainer's settings, open assignments, due constructions and
// statistics for the signed-in learner. Writes go through the same validation
// the MCP tools use.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { parseTrainer } from "@/lib/grammar/config";
import { dueKeys, grammarSummary } from "@/lib/grammar/stats";
import { listSessions, readConfig, writeConfig } from "@/lib/grammar/store";
import { readGrammarEvents } from "@/lib/training/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ trainer: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const trainer = parseTrainer((await params).trainer);
  if (!trainer) return NextResponse.json({ error: "Unknown trainer" }, { status: 404 });
  const url = new URL(req.url);
  const withStats = url.searchParams.get("stats") === "1";
  try {
    const [config, sessions, events] = await Promise.all([
      readConfig(supabaseAdmin, user.id, trainer),
      listSessions(supabaseAdmin, user.id, url.origin, { trainer, openOnly: true }),
      readGrammarEvents(supabaseAdmin, user.id, trainer, withStats ? "all" : "last_30_days"),
    ]);
    return NextResponse.json({
      ...config,
      sessions,
      due: dueKeys(events),
      stats: withStats ? grammarSummary(events) : undefined,
    });
  } catch (error) {
    console.error("grammar trainer:", error);
    return NextResponse.json({ error: "Не удалось загрузить настройки тренажёра." }, { status: 500 });
  }
}

export async function PUT(req: Request, { params }: { params: Promise<{ trainer: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  const trainer = parseTrainer((await params).trainer);
  if (!trainer) return NextResponse.json({ error: "Unknown trainer" }, { status: 404 });
  let body: { config?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json(await writeConfig(supabaseAdmin, user.id, trainer, body.config ?? {}, "learner"));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить настройки." }, { status: 400 });
  }
}
