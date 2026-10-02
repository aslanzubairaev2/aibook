// The learner's published tests, for the home screen.

import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { AssessmentError, listForLearner } from "@/lib/assessments/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ tests: [] });
  try {
    return NextResponse.json({ tests: await listForLearner(supabaseAdmin, user.id) });
  } catch (error) {
    // Before the migration has run the table is missing; the home screen just shows nothing.
    const status = error instanceof AssessmentError ? error.status : 500;
    return NextResponse.json({ tests: [], error: error instanceof Error ? error.message : "failed" }, { status: status === 500 ? 200 : status });
  }
}
