import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isAdminConfigured } from "@/lib/db/supabase-admin";
import { getUserFromRequest, isOwnerUser } from "@/lib/auth/serverUser";
import {
  fetchKlexikonTitles,
  fetchKlexikonArticle,
  KLEXIKON_LICENSE,
  KLEXIKON_COURSE_ID,
  KLEXIKON_COURSE_TITLE,
} from "@/lib/content/klexikon";

export const dynamic = "force-dynamic";

const HEADERS = { "User-Agent": "AIBook/1.0 (aslan.zubairaev@gmail.com) NextJS" };

// ─── Source 1: UniversalCEFR on HuggingFace ──────────────────────────────────
// Open, CEFR-labelled document-level texts. Levels come from the dataset, so
// no estimation is involved.
const HF_ROWS_BASE = "https://datasets-server.huggingface.co/rows";
const CEFR_DATASETS: { dataset: string; lang: string; label: string }[] = [
  { dataset: "UniversalCEFR/elg_cefr_de", lang: "de", label: "Немецкий" },
  { dataset: "UniversalCEFR/elg_cefr_en", lang: "en", label: "Английский" },
];
const CEFR_PER_LEVEL_CAP = 40;

// ─── Source 2: Klexikon ──────────────────────────────────────────────────────
// How many articles one import run pulls. The wiki has a few thousand; a full
// sweep would take ~30 minutes of polite request pacing, so import in batches.
const KLEXIKON_BATCH = 150;
const KLEXIKON_REQUEST_DELAY_MS = 250;

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
  // Klexikon is imported in batches; `offset` continues where the last run stopped.
  const klexikonOffset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10) || 0);

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

        // ── UniversalCEFR texts from HuggingFace ────────────────────────────
        if (type === "all" || type === "cefr") {
          send({ message: "Загрузка датасета UniversalCEFR с HuggingFace...", progress: 5 });
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

                const pct = 5 + Math.round(((d + 0.5) / CEFR_DATASETS.length) * (type === "cefr" ? 90 : 40));
                send({ message: `UniversalCEFR ${ds.label} ${cefr}: сохранено ${totalSaved}`, progress: pct });
              }
              offset += rows.length;
              if (rows.length < 100) break;
            }
          }

          send({
            message: `Импорт UniversalCEFR завершён. Сохранено ${totalSaved} текстов.`,
            progress: type === "cefr" ? 100 : 48,
          });
        }

        // ── Klexikon articles ───────────────────────────────────────────────
        if (type === "all" || type === "klexikon") {
          const base = type === "klexikon" ? 0 : 48;
          const span = type === "klexikon" ? 98 : 50;

          send({ message: "Получаю список статей Клексикона...", progress: base + 2 });

          let titles: string[] = [];
          try {
            // allpages is alphabetical and stable, so offset+batch resumes cleanly.
            const all = await fetchKlexikonTitles(klexikonOffset + KLEXIKON_BATCH);
            titles = all.slice(klexikonOffset);
          } catch (err) {
            send({ error: `Не удалось получить список статей Клексикона: ${err instanceof Error ? err.message : err}` });
            controller.close();
            return;
          }

          if (titles.length === 0) {
            send({ message: "Новых статей нет — весь Клексикон уже импортирован.", progress: 100, nextOffset: klexikonOffset });
            await delay(300);
            controller.close();
            return;
          }

          send({ message: `Найдено ${titles.length} статей. Начинаю импорт...`, progress: base + 4 });

          let saved = 0;
          let skipped = 0;
          for (let i = 0; i < titles.length; i++) {
            const title = titles[i];
            const pct = base + 4 + Math.round(((i + 1) / titles.length) * (span - 6));
            send({ message: `Клексикон (${i + 1}/${titles.length}): «${title}»`, progress: pct });

            try {
              const article = await fetchKlexikonArticle(title);
              if (!article) { skipped++; continue; }

              const { data: bookData } = await supabaseAdmin
                .from("shared_books")
                .upsert({
                  source_type: "klexikon",
                  source_id: `klexikon_${title.replace(/\s+/g, "_")}`,
                  title: article.title,
                  author: "Klexikon",
                  language: "de",
                  cefr_level: article.cefrLevel,
                  course_id: KLEXIKON_COURSE_ID,
                  course_title: KLEXIKON_COURSE_TITLE,
                  lesson_order: null,
                  total_chars: article.charCount,
                  metadata: {
                    description: article.paragraphs[0]?.slice(0, 180) ?? "",
                    cover_color: pickColor(article.title),
                    source_url: article.url,
                    license: KLEXIKON_LICENSE,
                    // The level is estimated from readability, not assigned by a
                    // human — the UI labels it as such.
                    level_estimated: true,
                    lix: article.lix,
                  },
                }, { onConflict: "source_type,source_id" })
                .select("id")
                .single();

              if (bookData) {
                await supabaseAdmin.from("shared_book_chapters").upsert({
                  shared_book_id: bookData.id,
                  chapter_index: 0,
                  title: article.title,
                  paragraphs: article.paragraphs,
                  plain_text: article.paragraphs.join("\n"),
                  char_count: article.charCount,
                }, { onConflict: "shared_book_id,chapter_index" });
                saved++;
              }
            } catch (err) {
              console.warn(`Klexikon fetch failed for ${title}:`, err);
              skipped++;
            }

            await delay(KLEXIKON_REQUEST_DELAY_MS);
          }

          // The client stores nextOffset so the following run continues from
          // here. Counting imported rows instead would drift, because skipped
          // stubs advance the cursor without producing a row.
          send({
            message: `Клексикон: сохранено ${saved}, пропущено ${skipped}.`,
            progress: base + span,
            nextOffset: klexikonOffset + titles.length,
          });
        }

        send({ message: "Импорт завершён.", progress: 100 });
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
