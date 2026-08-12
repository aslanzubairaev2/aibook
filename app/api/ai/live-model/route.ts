import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { pickLiveModel, DEFAULT_LIVE_MODEL, type ListedModel } from "@/lib/ai/liveModels";

export const dynamic = "force-dynamic";

// The answer changes about as often as Google retires a preview model, so it
// is held for the life of the server process rather than fetched per call.
let cached: { model: string; at: number } | null = null;
const CACHE_MS = 60 * 60 * 1000;

// GET /api/ai/live-model
//
// Which model the browser should open its voice session with. Asking the
// service beats hardcoding a preview id that stops existing one day without
// warning — the failure mode being an abrupt disconnect the learner cannot
// interpret.
export async function GET(req: Request) {
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch {
    return NextResponse.json({ model: DEFAULT_LIVE_MODEL, source: "default" });
  }

  if (cached && Date.now() - cached.at < CACHE_MS) {
    return NextResponse.json({ model: cached.model, source: "cache" });
  }

  const base = process.env.GEMINI_API_BASE_URL || "https://generativelanguage.googleapis.com";
  try {
    const res = await fetch(`${base}/v1beta/models?key=${encodeURIComponent(apiKey)}&pageSize=200`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`models list: ${res.status}`);
    const data = await res.json() as { models?: ListedModel[] };
    const model = pickLiveModel(data.models ?? []);
    cached = { model, at: Date.now() };
    return NextResponse.json({ model, source: "discovered" });
  } catch (err) {
    // Never fatal: the caller falls back to the built-in id and the call still
    // has every chance of working.
    console.warn("live-model discovery failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ model: DEFAULT_LIVE_MODEL, source: "default" });
  }
}
