// Training answers from the browser, in batches. The browser queues them
// (offline too) and resends until this route confirms; client_event_id makes
// a resend a no-op, so a lost reply never produces a duplicate.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { storeEvents } from "@/lib/training/store";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Server storage is not configured." }, { status: 503 });
  let body: { events?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!Array.isArray(body.events)) return NextResponse.json({ error: "events must be an array" }, { status: 400 });
  try {
    return NextResponse.json(await storeEvents(supabaseAdmin, user.id, body.events));
  } catch (error) {
    console.error("training events:", error);
    return NextResponse.json({ error: "Не удалось сохранить историю тренировки." }, { status: 500 });
  }
}
