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
// a stateless server needs is a handful of methods, and a dependency-free route
// is one less thing to break on the Hobby build.
//
// Tools, prompts and resources are all served, because clients disagree about
// which of them the model ever sees: ChatGPT's connector UI drops the server's
// instructions, some clients never fetch resources, and a few show prompts to
// the user as a menu. The same description of the app therefore reaches the
// other side by three routes — see lib/mcp/capabilities.ts.
//
// Auth: the personal token lives in the URL path (/api/mcp/<token>) because
// ChatGPT's and Claude's connector UIs accept a bare URL but not custom
// headers. The token is HMAC-signed (lib/mcp/token.ts) and scopes every query
// to the one user it was minted for.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { verifyMcpToken } from "@/lib/mcp/token";
import { MCP_TOOLS, buildGuideMarkdown, callMcpTool } from "@/lib/mcp/tools";
import { MCP_PROMPTS, getPrompt } from "@/lib/mcp/prompts";
import { buildInstructions } from "@/lib/mcp/capabilities";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Versions this server knows. A client asking for something newer gets the
// latest of these back, which is how MCP version negotiation is defined.
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = {
  name: "aibook",
  title: "aibook — карточки, словарь и тексты",
  version: "1.2.0",
};

const INSTRUCTIONS = buildInstructions();

// What the app can be asked for, served as documents as well as tools. Clients
// differ in what they put in front of the model — some read resources, some
// only ever call tools — so the same map is reachable three ways.
const RESOURCES = [
  {
    uri: "aibook://guide",
    name: "aibook_guide",
    title: "Что умеет aibook",
    description: "Every area of the app, the tools that reach it, and what this connection cannot do.",
    mimeType: "text/markdown",
  },
  {
    uri: "aibook://state",
    name: "learner_state",
    title: "Состояние ученика",
    description: "Live snapshot: languages, deck and dictionary sizes, recent lessons, reading progress.",
    mimeType: "application/json",
  },
  {
    uri: "aibook://progress",
    name: "learning_progress",
    title: "Как идёт учёба",
    description: "Live spaced-repetition record: confident words, words in progress, words being forgotten.",
    mimeType: "application/json",
  },
];

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
        capabilities: {
          tools: { listChanged: false },
          prompts: { listChanged: false },
          resources: { listChanged: false, subscribe: false },
        },
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
    case "resources/list":
      return rpcResult(id, { resources: RESOURCES });
    case "resources/templates/list":
      return rpcResult(id, { resourceTemplates: [] });
    case "resources/read": {
      const uri = String(msg.params?.uri ?? "");
      if (uri === "aibook://guide") {
        return rpcResult(id, {
          contents: [{ uri, mimeType: "text/markdown", text: buildGuideMarkdown() }],
        });
      }
      const toolForUri: Record<string, string> = {
        "aibook://state": "get_overview",
        "aibook://progress": "get_progress",
      };
      const tool = toolForUri[uri];
      if (!tool) return rpcError(id, -32602, `Unknown resource: ${uri}`);
      try {
        const data = await callMcpTool(supabaseAdmin!, userId, tool, {});
        return rpcResult(id, {
          contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data, null, 2) }],
        });
      } catch (err) {
        return rpcError(id, -32603, err instanceof Error ? err.message : "Resource read failed.");
      }
    }
    case "prompts/list":
      return rpcResult(id, {
        prompts: MCP_PROMPTS.map((p) => ({
          name: p.name,
          title: p.title,
          description: p.description,
          arguments: p.arguments,
        })),
      });
    case "prompts/get": {
      const name = String(msg.params?.name ?? "");
      const prompt = getPrompt(name);
      if (!prompt) return rpcError(id, -32602, `Unknown prompt: ${name}`);
      const args = (msg.params?.arguments ?? {}) as Record<string, string>;
      return rpcResult(id, {
        description: prompt.description,
        messages: [
          { role: "user", content: { type: "text", text: prompt.build(args) } },
        ],
      });
    }
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
