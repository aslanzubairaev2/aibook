import { NextRequest, NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getDeterministicUUID } from "@/lib/db/deterministicUuid";
import { getUserFromRequest } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 15000;

// ─── SSRF guards ──────────────────────────────────────────────────────────────
// The route fetches a user-supplied URL, so without these checks it could be
// used to reach internal services (localhost, cloud metadata, private LAN).

function isPrivateIpV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 || a === 10 || a === 127 ||                  // 0/8, 10/8, loopback
    (a === 100 && b >= 64 && b <= 127) ||                // 100.64/10 (CGNAT)
    (a === 169 && b === 254) ||                          // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||                 // 172.16/12
    (a === 192 && b === 168) ||                          // 192.168/16
    a >= 224                                             // multicast / reserved
  );
}

function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) return isPrivateIpV4(ip);
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIpV4(v6.slice(7)); // v4-mapped
  return (
    v6 === "::" || v6 === "::1" ||                       // unspecified / loopback
    v6.startsWith("fc") || v6.startsWith("fd") ||        // unique local fc00::/7
    v6.startsWith("fe8") || v6.startsWith("fe9") ||
    v6.startsWith("fea") || v6.startsWith("feb")         // link-local fe80::/10
  );
}

/** Throws if the URL must not be fetched (non-https, IP literal, private address). */
async function assertPublicHttpsUrl(target: URL): Promise<void> {
  if (target.protocol !== "https:") {
    throw new Error("Only https:// URLs are allowed");
  }
  const host = target.hostname;
  if (isIP(host)) {
    throw new Error("IP-literal URLs are not allowed");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Host is not allowed");
  }
  const addresses = await lookup(host, { all: true });
  if (addresses.length === 0 || addresses.some((a) => isPrivateIp(a.address))) {
    throw new Error("Host resolves to a private address");
  }
}

/** Fetch with manual redirect handling so every hop is re-validated. */
async function safeFetch(initialUrl: URL): Promise<Response> {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHttpsUrl(current);
    const res = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": "AIBook/1.0 (aslan.zubairaev@gmail.com) NextJS Scraper Client",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) throw new Error("Redirect without Location header");
      current = new URL(location, current);
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");
  const title = searchParams.get("title") ?? "Статья OERSI";
  const author = searchParams.get("author") ?? "OERSI Агрегатор";
  const lang = searchParams.get("lang") ?? "de";

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }

  try {
    const res = await safeFetch(target);

    if (!res.ok) {
      throw new Error(`Failed to load target URL: ${res.status}`);
    }

    const html = await res.text();
    const paragraphs = cleanHtmlToParagraphs(html);

    if (paragraphs.length === 0) {
      throw new Error("Не удалось извлечь читаемый текст с указанной страницы.");
    }

    // Compile into a beautiful Book object
    const bookId = getDeterministicUUID(targetUrl);
    const scrapedBook = {
      id: bookId,
      title: title,
      author: author,
      language: lang,
      format: "txt",
      progress: 0,
      paragraphIndex: 0,
      chapterTitle: "Начало",
      lastReadAt: new Date().toLocaleDateString("ru"),
      coverColor: "linear-gradient(160deg, #3a5c8a 0%, #1a2c4a 100%)", // sleek dark blue gradient
      paragraphs: paragraphs,
      cefrLevel: "B1", // Default leveled tag for scratched documents
      sourceType: "oersi" // OERSI source type
    };

    return NextResponse.json({ book: scrapedBook });
  } catch (err) {
    console.error("Scraper API error:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Неизвестная ошибка скрейпинга" }, { status: 500 });
  }
}

function cleanHtmlToParagraphs(html: string): string[] {
  const paragraphs: string[] = [];

  // Remove scripts and style tags entirely
  let cleanHtml = html
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, "")
    .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "")
    .replace(/<header[^>]*>([\s\S]*?)<\/header>/gi, "")
    .replace(/<footer[^>]*>([\s\S]*?)<\/footer>/gi, "")
    .replace(/<nav[^>]*>([\s\S]*?)<\/nav>/gi, "");

  // Match text inside <p> or <li> or headings or general block wrappers
  const matches = cleanHtml.match(/<(p|li|h1|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi);

  if (matches) {
    for (const match of matches) {
      const text = match
        .replace(/<[^>]*>/g, "") // strip inner tags
        .replace(/&nbsp;/g, " ")
        .replace(/&#91;.*?&#93;/g, "") // strip citation brackets
        .replace(/\s+/g, " ")
        .trim();

      // Keep substantial sentences/paragraphs and skip noises
      if (text.length > 30 && !text.includes("cookie") && !text.includes("Datenschutz") && !text.includes("Impressum")) {
        paragraphs.push(text);
      }
    }
  }

  // Fallback to text blocks split by line breaks if no tag matches
  if (paragraphs.length === 0) {
    const rawText = cleanHtml
      .replace(/<[^>]*>/g, "\n")
      .replace(/\s+/g, " ")
      .trim();
    const lines = rawText.split("\n");
    for (const line of lines) {
      const text = line.trim();
      if (text.length > 40) {
        paragraphs.push(text);
      }
    }
  }

  return paragraphs.slice(0, 40); // limit to 40 paragraphs to prevent overload
}
