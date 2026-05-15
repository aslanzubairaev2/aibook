import { parseTxt } from "./txt";
import { parseEpub } from "./epub";
import { parseFb2 } from "./fb2";

export type ParsedBook = {
  paragraphs: string[];
  title?: string;
  author?: string;
};

export async function parseBookDetailed(file: File): Promise<ParsedBook> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "txt") {
    const text = await file.text();
    return { paragraphs: parseTxt(text) };
  }

  if (ext === "epub") {
    return { paragraphs: await parseEpub(file) };
  }

  if (ext === "fb2") {
    const parsed = await parseFb2(file);
    return {
      paragraphs: parsed.paragraphs,
      title: parsed.meta.title,
      author: parsed.meta.author,
    };
  }

  throw new Error(`Unsupported format: .${ext}`);
}

export async function parseBook(file: File): Promise<string[]> {
  return (await parseBookDetailed(file)).paragraphs;
}

export function detectLanguageFromFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("_de") || lower.includes("-de")) return "de";
  if (lower.includes("_en") || lower.includes("-en")) return "en";
  if (lower.includes("_fr") || lower.includes("-fr")) return "fr";
  if (lower.includes("_es") || lower.includes("-es")) return "es";
  return "en"; // default
}
