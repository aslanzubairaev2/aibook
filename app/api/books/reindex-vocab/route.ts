import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin, isAdminConfigured } from "@/lib/db/supabase-admin";
import { getUserFromRequest, isOwnerUser } from "@/lib/auth/serverUser";
import { vocabMetadata } from "@/lib/text/vocab";

export const dynamic = "force-dynamic";
// Reading and rewriting every shared text takes longer than the default budget.
export const maxDuration = 300;

// Rows per round trip. Chapter text is a couple of KB each, so this keeps a
// single response comfortably small while still making steady progress.
const PAGE_SIZE = 50;

// GET /api/books/reindex-vocab
//
// Backfills word_counts / token_total onto texts imported before coverage
// existed. Texts written from now on get it at import time, so this is a
// one-off — but it is safe to re-run: it only ever overwrites those two keys.
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user || !isOwnerUser(user)) {
    return NextResponse.json(
      { error: "Пересчёт словаря доступен только владельцу приложения." },
      { status: 403 },
    );
  }

  const force = req.nextUrl.searchParams.get("force") === "1";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        if (!isAdminConfigured || !supabaseAdmin) {
          send({ error: "SUPABASE_SERVICE_ROLE_KEY не настроен." });
          controller.close();
          return;
        }

        const { count } = await supabaseAdmin
          .from("shared_books")
          .select("id", { count: "exact", head: true });
        const total = count ?? 0;

        send({ message: `Найдено ${total} текстов. Считаю словарь...`, progress: 2 });

        let processed = 0;
        let updated = 0;
        let skipped = 0;
        let offset = 0;

        while (true) {
          const { data: books, error } = await supabaseAdmin
            .from("shared_books")
            .select("id, title, metadata")
            .order("created_at", { ascending: true })
            .range(offset, offset + PAGE_SIZE - 1);

          if (error) {
            send({ error: `Ошибка чтения каталога: ${error.message}` });
            controller.close();
            return;
          }
          if (!books || books.length === 0) break;

          for (const book of books) {
            processed++;
            const metadata = (book.metadata ?? {}) as Record<string, unknown>;

            if (!force && metadata.token_total) {
              skipped++;
              continue;
            }

            const { data: chapters } = await supabaseAdmin
              .from("shared_book_chapters")
              .select("plain_text, paragraphs")
              .eq("shared_book_id", book.id)
              .order("chapter_index", { ascending: true });

            // plain_text is what the importers write, but fall back to the
            // paragraph array so a row with only paragraphs still gets indexed.
            const text = (chapters ?? [])
              .map((c) => (c.plain_text as string | null) ?? ((c.paragraphs as string[] | null) ?? []).join(" "))
              .join(" ")
              .trim();

            if (!text) {
              skipped++;
              continue;
            }

            const { error: updateError } = await supabaseAdmin
              .from("shared_books")
              .update({ metadata: { ...metadata, ...vocabMetadata(text) } })
              .eq("id", book.id);

            if (updateError) {
              console.warn(`reindex-vocab failed for ${book.id}:`, updateError.message);
              skipped++;
            } else {
              updated++;
            }
          }

          send({
            message: `Обработано ${processed} из ${total} · пересчитано ${updated}`,
            progress: total > 0 ? Math.min(98, 2 + Math.round((processed / total) * 96)) : 50,
          });

          offset += books.length;
          if (books.length < PAGE_SIZE) break;
        }

        send({
          message: `Готово. Пересчитано ${updated}, пропущено ${skipped}.`,
          progress: 100,
        });
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
