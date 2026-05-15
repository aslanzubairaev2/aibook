export async function parseEpub(file: File): Promise<string[]> {
  // Dynamic import to avoid SSR issues
  const ePub = (await import("epubjs")).default;
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer);
  await book.ready;

  const paragraphs: string[] = [];

  const spine = book.spine as unknown as { items: { href: string }[] };
  for (const item of spine.items) {
    const section = await book.load(item.href);
    const doc = section as Document;
    const pTags = doc.querySelectorAll ? doc.querySelectorAll("p, h1, h2, h3") : [];
    for (const el of Array.from(pTags)) {
      const text = (el as HTMLElement).textContent?.trim() ?? "";
      if (text.length > 20) paragraphs.push(text);
    }
  }

  return paragraphs;
}
