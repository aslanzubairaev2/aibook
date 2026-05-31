import { NextRequest, NextResponse } from "next/server";
import { getDeterministicUUID } from "@/lib/db/deterministicUuid";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const targetUrl = searchParams.get("url");
  const title = searchParams.get("title") ?? "Статья OERSI";
  const author = searchParams.get("author") ?? "OERSI Агрегатор";
  const lang = searchParams.get("lang") ?? "de";

  if (!targetUrl) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }

  try {
    const res = await fetch(targetUrl, {
      headers: {
        "User-Agent": "AIBook/1.0 (aslan.zubairaev@gmail.com) NextJS Scraper Client",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

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
