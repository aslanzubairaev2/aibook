import { NextRequest, NextResponse } from "next/server";

const ALLOWED_HOSTS = new Set(["www.gutenberg.org", "gutenberg.org"]);

export async function GET(req: NextRequest) {
  const source = req.nextUrl.searchParams.get("url");

  if (!source) {
    return new NextResponse("Missing url", { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(source.replace(/^http:\/\//, "https://"));
  } catch {
    return new NextResponse("Invalid url", { status: 400 });
  }

  if (!ALLOWED_HOSTS.has(target.hostname)) {
    return new NextResponse("Host is not allowed", { status: 403 });
  }

  const upstream = await fetch(target, {
    redirect: "follow",
    headers: {
      "User-Agent": "AIBook/1.0",
      Accept: "text/plain, application/octet-stream, */*",
    },
  });

  if (!upstream.ok) {
    return new NextResponse("Unable to load book text", { status: upstream.status });
  }

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "text/plain; charset=utf-8",
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length") as string }
        : {}),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
