import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";

export async function GET(req: Request) {
  try {
    const key = await getApiKeyForRequest(req);
    // If the key matches the server-side key, the user has server-side access (owner/allowlist).
    const isOwner = Boolean(process.env.GEMINI_API_KEY && key === process.env.GEMINI_API_KEY);
    return NextResponse.json({ hasServerAccess: isOwner });
  } catch (err) {
    return NextResponse.json({ hasServerAccess: false });
  }
}
