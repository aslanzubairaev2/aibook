import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { mintMcpToken } from "@/lib/mcp/token";

export const dynamic = "force-dynamic";

// GET /api/mcp-token
//
// Hands the logged-in user their personal MCP connection URL. Minting is
// deterministic (HMAC over the user id), so calling this twice returns the
// same URL — there is nothing stored and nothing to leak from a database.
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы получить ссылку для подключения ИИ." }, { status: 401 });
  }

  const token = mintMcpToken(user.id);
  if (!token) {
    return NextResponse.json({ error: "На сервере не настроен секрет для MCP-токенов." }, { status: 503 });
  }

  // The public origin, not the internal one: behind Vercel the forwarded
  // headers carry the domain the user actually visits.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const url = host ? `${proto}://${host}/api/mcp/${token}` : `/api/mcp/${token}`;

  return NextResponse.json({ url });
}
