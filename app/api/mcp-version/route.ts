// GET /api/mcp-version — "did my deploy actually land?"
//
// The MCP endpoint itself cannot answer that: it needs a personal token, and
// its replies are JSON-RPC, which is not something you can eyeball in a browser
// tab. When a connected agent shows an old set of tools there are two suspects
// — a stale deployment or a client that cached the tool list at connection time
// — and telling them apart used to mean crafting a signed request by hand.
//
// So this page states what this deployment is running, in the open. No token,
// no user data: a version, the commit Vercel built, and the names of the tools
// this build serves. If the tool you are looking for is in this list but your
// agent does not offer it, the agent is holding an old list; reconnect it.

import { NextResponse } from "next/server";
import { MCP_TOOLS } from "@/lib/mcp/tools";
import { MCP_PROMPTS } from "@/lib/mcp/prompts";

export const dynamic = "force-dynamic";

export async function GET() {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  return NextResponse.json({
    server: "aibook MCP",
    version: "1.2.0",
    commit: commit ? commit.slice(0, 7) : "unknown (not built on Vercel)",
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    tool_count: MCP_TOOLS.length,
    tools: MCP_TOOLS.map((t) => t.name),
    prompts: MCP_PROMPTS.map((p) => p.name),
    resources: ["aibook://guide", "aibook://state", "aibook://progress"],
    // Booleans only — whether the server is configured, never with what.
    configured: {
      database: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.NEXT_PUBLIC_SUPABASE_URL),
      token_secret: Boolean(process.env.MCP_TOKEN_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY),
    },
    hint: "Если нужного инструмента нет в этом списке — не обновился сервер. Если он тут есть, а ИИ-агент его не видит — переподключи коннектор и начни новый чат.",
  });
}
