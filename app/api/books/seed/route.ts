import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isAdminConfigured } from "@/lib/db/supabase-admin";
import { LEVELED_TEXTS_SEED } from "@/lib/db/leveledTextsData";
import { getUserFromRequest, isOwnerUser } from "@/lib/auth/serverUser";

export const dynamic = "force-dynamic";

const COURSE_ID = "wikibooks_german";
const COURSE_TITLE = "German (Wikibooks)";
const WIKIBOOKS_BASE = "https://en.wikibooks.org/w/api.php";
const HEADERS = { "User-Agent": "AIBook/1.0 (aslan.zubairaev@gmail.com) NextJS" };

// UniversalCEFR datasets on HuggingFace (open, CEFR-labelled document-level texts)
const HF_ROWS_BASE = "https://datasets-server.huggingface.co/rows";
const CEFR_DATASETS: { dataset: string; lang: string; label: string }[] = [
  { dataset: "UniversalCEFR/elg_cefr_de", lang: "de", label: "Немецкий" },
  { dataset: "UniversalCEFR/elg_cefr_en", lang: "en", label: "Английский" },
];
const CEFR_PER_LEVEL_CAP = 40;

type CefrRow = { title?: string; lang?: string; cefr_level?: string; text?: string };

// Dataset "title" is often a filename ("041a47a8-….txt", "text_0.txt") or "na" —
// only keep it when it looks like a human-written name.
function cleanCefrTitle(raw?: string): string | null {
  const title = (raw ?? "").trim();
  if (!title || title.toLowerCase() === "na") return null;
  if (/\.(txt|csv|json|tsv)$/i.test(title)) return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(title)) return null;
  return title;
}

function normalizeCefrLevel(raw?: string): string | null {
  if (!raw) return null;
  const m = raw.toUpperCase().match(/[ABC][12]/);
  return m ? m[0] : null;
}

// HF texts are hard-wrapped mid-sentence ("…mit Greta\nins Kino."). A line
// break is a real paragraph boundary only when the line ends a sentence;
// otherwise the wrap is typographic and the lines must be rejoined.
const SENTENCE_END_RE = /[.!?…:][)"“”„«»'"]*$/u;

function unwrapHardLineBreaks(text: string): string[] {
  const out: string[] = [];
  let current = "";
  for (const rawLine of text.split(/\n/)) {
    const line = rawLine.trim();
    if (!line) {
      // Blank line: always a paragraph boundary.
      if (current) { out.push(current); current = ""; }
      continue;
    }
    current = current ? `${current} ${line}` : line;
    if (SENTENCE_END_RE.test(line)) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

// Split a document-level text into reader paragraphs.
function splitCefrText(text: string): string[] {
  const source = unwrapHardLineBreaks(text);
  const paragraphs: string[] = [];
  for (const block of source) {
    if (block.length <= 320) { paragraphs.push(block); continue; }
    // Group sentences into ~320-char paragraphs for readability
    const sentences = block.match(/[^.!?]+[.!?]+[)"“”„«»'"]*|[^.!?]+$/gu) ?? [block];
    let current = "";
    for (const s of sentences) {
      if ((current + s).length > 320 && current) { paragraphs.push(current.trim()); current = ""; }
      current += s;
    }
    if (current.trim()) paragraphs.push(current.trim());
  }
  return paragraphs;
}

async function fetchCefrRows(dataset: string, offset: number, length: number): Promise<CefrRow[]> {
  const params = new URLSearchParams({ dataset, config: "default", split: "train", offset: String(offset), length: String(length) });
  const res = await fetch(`${HF_ROWS_BASE}?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) return [];
  const data = await res.json() as { rows?: { row: CefrRow }[] };
  return (data.rows ?? []).map((r) => r.row);
}

type WikiCategory = "lesson" | "grammar" | "vocabulary";

type WikiPage = {
  page: string;       // full page title, e.g. "German/Lesson 1"
  shortTitle: string; // display title
  category: WikiCategory;
  order: number;      // sort order within course
  cefr: string;
};

function pickColor(title: string) {
  const colors = [
    "linear-gradient(160deg, #c49a28 0%, #7a5c10 100%)",
    "linear-gradient(160deg, #4a7a5c 0%, #254030 100%)",
    "linear-gradient(160deg, #3a5c8a 0%, #1a2c4a 100%)",
    "linear-gradient(160deg, #8a3a3a 0%, #4a1a1a 100%)",
    "linear-gradient(160deg, #6a3a8a 0%, #35174a 100%)",
    "linear-gradient(160deg, #8a5a2a 0%, #4a2a0a 100%)",
  ];
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

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
    .replace(/ /g, " ");
}

function cleanMediaWikiHtml(html: string): string[] {
  const paragraphs: string[] = [];
  // Remove navboxes, tables, edit buttons, references
  const cleaned = html
    .replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, "")
    .replace(/<div[^>]*class="[^"]*(?:navbox|reflist|toc|mw-editsection|sistersitebox|noprint)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, "")
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, "");

  const matches = cleaned.match(/<(p|li|dt|dd)[^>]*>([\s\S]*?)<\/\1>/gi);
  if (matches) {
    for (const match of matches) {
      const text = decodeHtmlEntities(match.replace(/<[^>]*>/g, ""))
        .replace(/\[.*?\]/g, "")
        .replace(/[«»<>]{2,}/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (
        text.length > 20 &&
        !text.startsWith("Bearbeiten") &&
        !text.includes("Wikibooks") &&
        !text.includes("Diese Seite") &&
        !text.includes("Bitte beachte") &&
        !/^(Lesson Layout Guide|Pronunciation Guide|Lessons?|Contents?)\s*$/i.test(text)
      ) {
        paragraphs.push(text);
      }
    }
  }
  if (paragraphs.length === 0) {
    const raw = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (raw) paragraphs.push(raw.slice(0, 800));
  }
  return paragraphs.slice(0, 60);
}

// Map a German/ subpage title to a categorized WikiPage (or null to skip).
function categorizeWikiPage(title: string): WikiPage | null {
  // Lessons: "German/Lesson 1", "German/Lesson 5B"
  const lessonMatch = title.match(/^German\/Lesson\s+(\d+)([A-Z]?)$/i);
  if (lessonMatch) {
    const num = parseInt(lessonMatch[1], 10);
    const cefr = num <= 5 ? "A1" : num <= 10 ? "A2" : "B1";
    return {
      page: title,
      shortTitle: title.replace("German/", ""),
      category: "lesson",
      order: 100 + num * 2 + (lessonMatch[2] ? 1 : 0),
      cefr,
    };
  }
  // Grammar reference pages
  if (/^German\/Grammar\/.+/i.test(title)) {
    return {
      page: title,
      shortTitle: title.replace("German/Grammar/", "Grammatik: "),
      category: "grammar",
      order: 500,
      cefr: "B1",
    };
  }
  // Vocabulary appendices
  if (/^German\/Appendices\/Vocabulary\/.+/i.test(title)) {
    return {
      page: title,
      shortTitle: title.replace("German/Appendices/Vocabulary/", "Wortschatz: "),
      category: "vocabulary",
      order: 900,
      cefr: "A1",
    };
  }
  return null;
}

// Fetch all German course subpages from en.wikibooks.org and categorize them.
async function fetchAllWikibooksLessonPages(): Promise<WikiPage[]> {
  const results: WikiPage[] = [];
  let continueToken: string | undefined;

  do {
    const params = new URLSearchParams({
      action: "query",
      list: "allpages",
      apprefix: "German/",
      apnamespace: "0",
      aplimit: "500",
      format: "json",
      ...(continueToken ? { apcontinue: continueToken } : {}),
    });

    const res = await fetch(`${WIKIBOOKS_BASE}?${params}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) break;
    const data = await res.json() as {
      query?: { allpages?: { pageid: number; title: string }[] };
      continue?: { apcontinue: string };
    };

    const pages = data?.query?.allpages ?? [];
    for (const p of pages) {
      const categorized = categorizeWikiPage(p.title);
      if (categorized) results.push(categorized);
    }

    continueToken = data?.continue?.apcontinue;
  } while (continueToken);

  // Lessons first (by number), then grammar, then vocabulary
  results.sort((a, b) => a.order - b.order || a.shortTitle.localeCompare(b.shortTitle));
  return results;
}

async function scrapeWikibooksPage(page: string): Promise<string[]> {
  const params = new URLSearchParams({
    action: "parse",
    page,
    format: "json",
    prop: "text",
    disableeditsection: "1",
  });

  const res = await fetch(`${WIKIBOOKS_BASE}?${params}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) return [];
  const data = await res.json() as { parse?: { text?: { "*": string } } };
  const rawHtml = data?.parse?.text?.["*"];
  if (!rawHtml) return [];
  return cleanMediaWikiHtml(rawHtml);
}

export async function GET(req: NextRequest) {
  // Seeding writes to shared tables via the service-role client — owners only.
  const user = await getUserFromRequest(req);
  if (!user || !isOwnerUser(user)) {
    return NextResponse.json(
      { error: "Импорт каталога доступен только владельцу приложения." },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") ?? "all";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        if (!isAdminConfigured || !supabaseAdmin) {
          send({ error: "SUPABASE_SERVICE_ROLE_KEY не настроен. Добавьте его в .env.local (Project Settings → API → service_role)." });
          controller.close();
          return;
        }

        send({ message: "Подключение к базе данных...", progress: 2 });
        await delay(300);

        // ── Part 1: Pre-packaged Wikibooks seed lessons ──────────────────────
        if (type === "all" || type === "wikibooks" || type === "leveled") {
          const wikibooksSeeds = LEVELED_TEXTS_SEED.filter((t) => t.sourceType === "wikibooks");

          send({ message: `Импорт ${wikibooksSeeds.length} базовых уроков Wikibooks...`, progress: 5 });

          let idx = 0;
          for (const text of wikibooksSeeds) {
            idx++;
            const sourceId = `wikibooks_lesson_${text.lessonNumber ?? text.title.slice(0, 20).replace(/\s+/g, "_")}`;
            const orderNum = parseFloat(text.lessonNumber ?? "0") * 10;
            const { data: bookData } = await supabaseAdmin
              .from("shared_books")
              .upsert({
                source_type: "wikibooks",
                source_id: sourceId,
                title: text.title,
                author: text.author ?? "Wikibooks",
                language: text.language,
                cefr_level: text.cefrLevel,
                course_id: COURSE_ID,
                course_title: COURSE_TITLE,
                lesson_order: Math.round(orderNum),
                total_chars: text.paragraphs.join("").length,
                metadata: { description: text.description ?? "", cover_color: pickColor(text.title) },
              }, { onConflict: "source_type,source_id" })
              .select("id")
              .single();

            if (bookData) {
              await supabaseAdmin.from("shared_book_chapters").upsert({
                shared_book_id: bookData.id,
                chapter_index: 0,
                title: text.title,
                paragraphs: text.paragraphs,
                plain_text: text.paragraphs.join("\n"),
                char_count: text.paragraphs.join("").length,
              }, { onConflict: "shared_book_id,chapter_index" });
            }
            send({ message: `Базовый урок ${idx}/${wikibooksSeeds.length}: "${text.title}"`, progress: 5 + Math.round((idx / wikibooksSeeds.length) * 10) });
            await delay(50);
          }
        }

        // ── Part 1b: UniversalCEFR texts from HuggingFace ────────────────────
        if (type === "all" || type === "cefr") {
          send({ message: "Загрузка датасета UniversalCEFR с HuggingFace...", progress: 8 });
          let totalSaved = 0;

          for (let d = 0; d < CEFR_DATASETS.length; d++) {
            const ds = CEFR_DATASETS[d];
            const perLevel: Record<string, number> = {};
            let offset = 0;

            // Scan the whole dataset (rows are grouped by level), keeping up to
            // CEFR_PER_LEVEL_CAP per CEFR level so every level (incl. A1) appears.
            while (true) {
              let rows: CefrRow[] = [];
              try {
                rows = await fetchCefrRows(ds.dataset, offset, 100);
              } catch (err) {
                send({ message: `Ошибка загрузки ${ds.dataset}: ${err instanceof Error ? err.message : err}`, progress: 10 });
                break;
              }
              if (rows.length === 0) break;

              for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const text = (row.text ?? "").trim();
                const cefr = normalizeCefrLevel(row.cefr_level);
                if (text.length < 120 || !cefr) continue;
                if ((perLevel[cefr] ?? 0) >= CEFR_PER_LEVEL_CAP) continue;

                const paragraphs = splitCefrText(text);
                if (paragraphs.length === 0) continue;

                perLevel[cefr] = (perLevel[cefr] ?? 0) + 1;
                const globalIdx = offset + i;
                const title = cleanCefrTitle(row.title)
                  ?? `${ds.label} ${cefr} · текст ${perLevel[cefr]}`;
                const sourceId = `universal_cefr_${ds.lang}_${ds.dataset.split("/")[1]}_${globalIdx}`;

                const { data: bookData } = await supabaseAdmin
                  .from("shared_books")
                  .upsert({
                    source_type: "universal_cefr",
                    source_id: sourceId,
                    title,
                    author: "UniversalCEFR",
                    language: ds.lang,
                    cefr_level: cefr,
                    course_id: null,
                    course_title: null,
                    lesson_order: null,
                    total_chars: text.length,
                    metadata: {
                      description: `Текст уровня ${cefr} (${ds.label}) из открытого корпуса UniversalCEFR.`,
                      cover_color: pickColor(title),
                      dataset: ds.dataset,
                    },
                  }, { onConflict: "source_type,source_id" })
                  .select("id")
                  .single();

                if (bookData) {
                  await supabaseAdmin.from("shared_book_chapters").upsert({
                    shared_book_id: bookData.id,
                    chapter_index: 0,
                    title,
                    paragraphs,
                    plain_text: paragraphs.join("\n"),
                    char_count: text.length,
                  }, { onConflict: "shared_book_id,chapter_index" });
                  totalSaved++;
                }

                const pct = 8 + Math.round(((d + 0.5) / CEFR_DATASETS.length) * (type === "cefr" ? 88 : 10));
                send({ message: `UniversalCEFR ${ds.label} ${cefr}: сохранено ${totalSaved}`, progress: pct });
              }
              offset += rows.length;
              if (rows.length < 100) break;
            }
          }

          send({
            message: `Импорт UniversalCEFR завершён. Сохранено ${totalSaved} текстов.`,
            progress: type === "cefr" ? 100 : 18,
          });
        }

        // ── Part 2: Full Wikibooks scrape ─────────────────────────────────────
        if (type === "all" || type === "wikibooks") {
          send({ message: "Загружаю полное оглавление Wikibooks DaF...", progress: 22 });

          let lessonPages: WikiPage[] = [];
          try {
            lessonPages = await fetchAllWikibooksLessonPages();
          } catch (err) {
            send({ message: `Не удалось загрузить оглавление: ${err instanceof Error ? err.message : err}.`, progress: 25 });
          }

          send({ message: `Найдено ${lessonPages.length} страниц курса German. Начинаю скачивание...`, progress: 28 });
          await delay(200);

          const categoryLabel: Record<WikiCategory, string> = {
            lesson: "Урок",
            grammar: "Грамматика",
            vocabulary: "Словарь",
          };

          let count = 0;
          let saved = 0;
          for (const lesson of lessonPages) {
            count++;
            const progressPct = 28 + Math.round((count / lessonPages.length) * 68);
            send({
              message: `Скачивание (${count}/${lessonPages.length}): "${lesson.shortTitle}"`,
              progress: progressPct,
            });

            try {
              const paragraphs = await scrapeWikibooksPage(lesson.page);
              if (paragraphs.length >= 2) {
                const sourceId = `wikibooks_de_${lesson.page.replace(/\//g, "_").replace(/\s+/g, "_")}`;

                const { data: bookData } = await supabaseAdmin!
                  .from("shared_books")
                  .upsert({
                    source_type: "wikibooks",
                    source_id: sourceId,
                    title: lesson.shortTitle,
                    author: "Wikibooks Contributors",
                    language: "de",
                    cefr_level: lesson.cefr,
                    course_id: COURSE_ID,
                    course_title: COURSE_TITLE,
                    lesson_order: lesson.order,
                    total_chars: paragraphs.join("").length,
                    metadata: {
                      description: `${categoryLabel[lesson.category]} Wikibooks German: ${lesson.shortTitle}`,
                      cover_color: pickColor(lesson.shortTitle),
                      wikibooks_page: lesson.page,
                      category: lesson.category,
                    },
                  }, { onConflict: "source_type,source_id" })
                  .select("id")
                  .single();

                if (bookData) {
                  await supabaseAdmin!.from("shared_book_chapters").upsert({
                    shared_book_id: bookData.id,
                    chapter_index: 0,
                    title: lesson.shortTitle,
                    paragraphs,
                    plain_text: paragraphs.join("\n"),
                    char_count: paragraphs.join("").length,
                  }, { onConflict: "shared_book_id,chapter_index" });
                  saved++;
                }
              }
            } catch (err) {
              console.warn(`Wikibooks fetch failed for ${lesson.page}:`, err);
            }
            await delay(200);
          }

          send({ message: `Сохранено ${saved} из ${lessonPages.length} страниц Wikibooks German.`, progress: 97 });
        }

        send({ message: "Импорт завершён! Учебная программа доступна для всех пользователей.", progress: 100 });
        await delay(300);
        controller.close();
      } catch (err) {
        send({ error: err instanceof Error ? err.message : "Неизвестная ошибка" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
