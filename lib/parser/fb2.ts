type Fb2Meta = {
  title?: string;
  author?: string;
};

function textOf(el: Element | null | undefined) {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

export async function parseFb2(file: File): Promise<{ paragraphs: string[]; meta: Fb2Meta }> {
  const xml = await file.text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const parserError = doc.querySelector("parsererror");

  if (parserError) {
    throw new Error("Не удалось разобрать FB2");
  }

  const titleInfo = doc.querySelector("description > title-info");
  const title = textOf(titleInfo?.querySelector("book-title"));
  const firstName = textOf(titleInfo?.querySelector("author first-name"));
  const middleName = textOf(titleInfo?.querySelector("author middle-name"));
  const lastName = textOf(titleInfo?.querySelector("author last-name"));
  const nickname = textOf(titleInfo?.querySelector("author nickname"));
  const author = [firstName, middleName, lastName].filter(Boolean).join(" ") || nickname;

  const blocks = Array.from(doc.querySelectorAll("body section title p, body section p, body poem stanza v"));
  const paragraphs = blocks
    .map((node) => textOf(node))
    .filter((text) => text.length > 20);

  return {
    paragraphs,
    meta: {
      title: title || undefined,
      author: author || undefined,
    },
  };
}
