import { NextResponse } from "next/server";
import { isOwnerRequest } from "@/lib/ai/serverAuth";

// The Gemini Live API connects directly from the browser to Google (a persistent
// WebSocket can't be proxied through a serverless route), so the owner's key has
// to reach the client. Only ever hand it out to the verified owner account.
export async function GET(req: Request) {
  const isOwner = await isOwnerRequest(req);
  if (!isOwner || !process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: "Not available" }, { status: 403 });
  }
  return NextResponse.json({ apiKey: process.env.GEMINI_API_KEY });
}
