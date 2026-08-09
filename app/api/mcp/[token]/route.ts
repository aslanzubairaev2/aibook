// MCP (Model Context Protocol) endpoint — lets any outside agent (ChatGPT,
// Claude, Gemini CLI, Codex…) read and write this learner's aibook data.
//
// Transport: streamable HTTP in its stateless form. Every request is one JSON-RPC
// POST answered with one JSON body — no sessions, no SSE stream, which is
// exactly what a serverless function can promise. The spec allows a server to
// respond with application/json instead of an event stream, and all the major
// clients accept it.
//
// Implemented by hand rather than with an SDK on purpose: the protocol surface
// a tools-only stateless server needs is four methods, and a dependency-free
// route is one less thing to break on the Hobby build.
//
// Auth: the personal token lives in the URL path (/api/mcp/<token>) because
// ChatGPT's and Claude's connector UIs accept a bare URL but not custom
// headers. The token is HMAC-signed (lib/mcp/token.ts) and scopes every query
// to the one user it was minted for.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { verifyMcpToken } from "@/lib/mcp/token";
import { MCP_TOOLS, callMcpTool } from "@/lib/mcp/tools";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Versions this server knows. A client asking for something newer gets the
// latest of these back, which is how MCP version negotiation is defined.
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = { name: "aibook", version: "1.0.0" };

const INSTRUCTIONS = `aibook is a language-learning reader app. The connected account belongs to one learner (their target and native language come from get_overview).

You can: see their vocabulary and progress (get_overview, get_study_words, list_flashcards, list_texts, get_text), add flashcards to their spaced-repetition deck (add_flashcards), and save reading texts you write into their lesson catalogue (create_lesson).

Typical flows:
- "добавь эти фразы мне как карточки" → add_flashcards with front = target-language phrase, back = native-language translation.
- "напиши рассказ из моих выученных слов" → get_study_words, write the story yourself at their level, then create_lesson.
- Discussing a text they are reading → list_texts, then get_text.`;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: number | string | null, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: number | string | null, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

// Browser-based MCP clients (inspector, playgrounds) need CORS; server-side
// clients ignore these headers.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

async function handleMessage(msg: JsonRpcRequest, userId: string): Promise<unknown | null> {
  const id = msg.id ?? null;
  const method = msg.method ?? "";

  // Notifications (no id) expect no response at all.
  if (msg.id === undefined && method.startsWith("notifications/")) return null;

  switch (method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return rpcResult(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return rpcResult(id, {});
    case "tools/list":
      return rpcResult(id, { tools: MCP_TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      try {
        const result = await callMcpTool(supabaseAdmin!, userId, name, args);
        return rpcResult(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        });
      } catch (err) {
        // Tool-level failures go back inside a successful response, as the
        // protocol wants, so the model can read the message and self-correct.
        return rpcResult(id, {
          content: [{ type: "text", text: err instanceof Error ? err.message : "Tool call failed." }],
          isError: true,
        });
      }
    }
    // Empty lists rather than "method not found": some clients probe for
    // resources/prompts even when the capability is not advertised.
    case "resources/list":
      return rpcResult(id, { resources: [] });
    case "prompts/list":
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const userId = verifyMcpToken(decodeURIComponent(token));
  if (!userId) {
    return json({ error: "Invalid or revoked MCP token." }, 401);
  }
  if (!supabaseAdmin) {
    return json({ error: "Server storage is not configured." }, 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, "Parse error: body is not valid JSON."), 400);
  }

  // Old-spec clients may still send batches; answer them item by item.
  const messages: JsonRpcRequest[] = Array.isArray(body) ? body : [body as JsonRpcRequest];
  const responses: unknown[] = [];
  for (const msg of messages) {
    const response = await handleMessage(msg, userId);
    if (response !== null) responses.push(response);
  }

  // Nothing but notifications → 202 with no body, per the transport spec.
  if (responses.length === 0) {
    return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  }
  return json(Array.isArray(body) ? responses : responses[0]);
}

// No server-initiated stream in stateless mode; clients treat 405 as "polling
// only", which is what the spec prescribes.
export async function GET() {
  return new NextResponse(null, { status: 405, headers: CORS_HEADERS });
}

// Session termination is a no-op for a stateless server.
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: CORS_HEADERS });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
