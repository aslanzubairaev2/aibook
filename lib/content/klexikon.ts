// Klexikon — a German encyclopedia written for children (klexikon.zum.de).
//
// Why this and not Wikibooks: Klexikon is *authentic German*, written by native
// speakers who deliberately keep sentences short and vocabulary common. That is
// exactly the reading material a learner at A2–B1 needs, and unlike the old
// Wikibooks scrape there are no English grammar explanations and no tables to
// lose. There is no "Simple German Wikipedia"; Klexikon fills that gap.
//
// License: CC BY-SA 4.0 — every imported article carries its source URL and
// license in `metadata` so the reader can attribute it.

import { computeLix, estimateCefrFromLix, type CefrBand } from "@/lib/text/readability";

const KLEXIKON_API = "https://klexikon.zum.de/api.php";
const KLEXIKON_PAGE_BASE = "https://klexikon.zum.de/wiki/";

export const KLEXIKON_LICENSE = "CC BY-SA 4.0";
export const KLEXIKON_COURSE_ID = "de_klexikon";
export const KLEXIKON_COURSE_TITLE = "Клексикон (немецкая детская энциклопедия)";

const HEADERS = { "User-Agent": "AIBook/1.0 (language reader) NextJS" };
const TIMEOUT_MS = 20000;

export type { CefrBand };

export type KlexikonArticle = {
  title: string;
  paragraphs: string[];
  charCount: number;
  cefrLevel: CefrBand;
  lix: number;
  url: string;
};


// ─── MediaWiki HTML → reader paragraphs ──────────────────────────────────────

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/ /g, " ");
}

// Section headings are kept (as their own paragraph) because the reader styles
// short heading-like lines via isLessonHeading — that is how an article keeps
// its structure instead of collapsing into a wall of text.
const DROP_PARAGRAPH_RE =
  /^(Bearbeiten|Weblinks?|Siehe auch|Einzelnachweise|Quellen?|Zum Weiterlesen)$/i;

export function klexikonHtmlToParagraphs(html: string): string[] {
  const cleaned = html
    .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "")
    .replace(/<figure[^>]*>[\s\S]*?<\/figure>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<div[^>]*class="[^"]*(?:navbox|reflist|toc|mw-editsection|thumbcaption|noprint|catlinks|printfooter)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, "")
    .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "");

  const paragraphs: string[] = [];
  const blocks = cleaned.match(/<(p|li|h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi) ?? [];

  for (const block of blocks) {
    const isHeading = /^<h[23]/i.test(block);
    const text = decodeHtmlEntities(block.replace(/<[^>]*>/g, ""))
      .replace(/\[\d+\]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    if (!text || DROP_PARAGRAPH_RE.test(text)) continue;
    // Headings are short by nature; body text under ~25 chars is navigation cruft.
    if (!isHeading && text.length < 25) continue;
    paragraphs.push(text);
  }

  // Trailing headings with no body under them add nothing to read.
  while (paragraphs.length > 0 && paragraphs[paragraphs.length - 1].length < 40) {
    paragraphs.pop();
  }
  return paragraphs;
}

// ─── API calls ───────────────────────────────────────────────────────────────

async function apiGet(params: Record<string, string>): Promise<unknown> {
  const search = new URLSearchParams({ ...params, format: "json", origin: "*" });
  const res = await fetch(`${KLEXIKON_API}?${search}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Klexikon API ${res.status}`);
  return res.json();
}

/** Article titles from main namespace, alphabetically, paged via `apcontinue`. */
export async function fetchKlexikonTitles(limit: number): Promise<string[]> {
  const titles: string[] = [];
  let continueToken: string | undefined;

  while (titles.length < limit) {
    const data = await apiGet({
      action: "query",
      list: "allpages",
      apnamespace: "0",
      apfilterredir: "nonredirects",
      aplimit: String(Math.min(500, limit - titles.length)),
      ...(continueToken ? { apcontinue: continueToken } : {}),
    }) as {
      query?: { allpages?: { title: string }[] };
      continue?: { apcontinue?: string };
    };

    const page = data.query?.allpages ?? [];
    if (page.length === 0) break;
    for (const p of page) titles.push(p.title);

    continueToken = data.continue?.apcontinue;
    if (!continueToken) break;
  }

  return titles.slice(0, limit);
}

/** Full article text, or null when the page is too short to be worth reading. */
export async function fetchKlexikonArticle(title: string): Promise<KlexikonArticle | null> {
  const data = await apiGet({
    action: "parse",
    page: title,
    prop: "text",
    redirects: "1",
  }) as { parse?: { title?: string; text?: { "*"?: string } }; error?: { info?: string } };

  const html = data.parse?.text?.["*"];
  if (!html) return null;

  const paragraphs = klexikonHtmlToParagraphs(html);
  const plain = paragraphs.join(" ");
  // Stubs (a heading plus one line) are not usable reading material.
  if (paragraphs.length < 3 || plain.length < 400) return null;

  const lix = computeLix(plain);
  return {
    title: data.parse?.title ?? title,
    paragraphs,
    charCount: plain.length,
    cefrLevel: estimateCefrFromLix(lix),
    lix: Math.round(lix * 10) / 10,
    url: KLEXIKON_PAGE_BASE + encodeURIComponent((data.parse?.title ?? title).replace(/ /g, "_")),
  };
}
