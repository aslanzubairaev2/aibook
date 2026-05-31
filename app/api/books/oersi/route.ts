import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") ?? "";
  const lang = searchParams.get("lang") ?? "de";
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));

  try {
    const filter: object[] = [{ term: { inLanguage: lang } }];

    const queryBody = q.trim()
      ? {
          query: {
            bool: {
              must: [
                {
                  multi_match: {
                    query: q,
                    fields: ["name^3", "description", "keywords"],
                  },
                },
              ],
              filter,
            },
          },
          from: page * PAGE_SIZE,
          size: PAGE_SIZE,
        }
      : {
          query: { bool: { filter } },
          from: page * PAGE_SIZE,
          size: PAGE_SIZE,
        };

    const res = await fetch("https://oersi.org/api/search/oer_data/_search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AIBook/1.0 (aslan.zubairaev@gmail.com) NextJS Client",
      },
      body: JSON.stringify(queryBody),
    });

    if (!res.ok) {
      console.warn("OERSI request failed with status:", res.status);
      return NextResponse.json({ results: [], total: 0, page, hasMore: false });
    }

    const data = await res.json() as any;
    const hits = data?.hits?.hits ?? [];
    const total: number = data?.hits?.total?.value ?? 0;

    const formatted = hits.map((hit: any) => {
      const source = hit._source;
      const resourceType: string = source.learningResourceType?.[0]?.prefLabel?.de
        ?? source.learningResourceType?.[0]?.prefLabel?.en
        ?? "";
      const encodingFormat: string = source.encoding?.[0]?.encodingFormat
        ?? source.mainEntityOfPage?.[0]?.encodingFormat
        ?? "";
      return {
        id: hit._id,
        title: source.name ?? "Без названия",
        description: source.description ?? "Описание отсутствует.",
        url: source.id ?? source.mainEntityOfPage?.[0]?.id ?? "",
        authors: source.creator?.map((c: any) => c.name).join(", ") ?? "Неизвестный автор",
        language: lang,
        source: "OERSI",
        resourceType,
        encodingFormat,
      };
    });

    return NextResponse.json({
      results: formatted,
      total,
      page,
      hasMore: (page + 1) * PAGE_SIZE < total,
    });
  } catch (err) {
    console.error("OERSI API error:", err);
    return NextResponse.json({ results: [], total: 0, page, hasMore: false });
  }
}
